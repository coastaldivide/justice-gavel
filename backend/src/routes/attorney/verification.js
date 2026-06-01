/**
 * attorney/verification.js — Bar verification submit + admin approve
 */
import { err400, err401, err403, err404, err409, err422, err500, err502,
         safeInt, sanitizeStr, validateEmail, withTransaction} from '../../utils/routeHelpers.js';
import { Router }       from 'express';
import { authRequired } from '../../middleware/auth.js';
import { getDb }        from '../../db/index.js';
import logger           from '../../utils/logger.js';
import { sanitiseField, sanitiseProfileFields, STATE_BAR_LOOKUP } from './_helpers.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';

const routeLimiter = makeUserLimiter(30, 60_000); // 30 req/min per user

const router = Router();


router.post('/verify-bar', authRequired, routeLimiter, async (req, res) => {
  /**
   * Attorney bar verification — Phase 1 of a two-phase process.
   *
   * PHASE 1 (this route): Attorney submits bar number + state.
   *   - Stored as pending_bar_verification = 1
   *   - bar_verified remains 0 (JTB badge NOT granted yet)
   *   - Admin notified by email with direct link to state bar lookup
   *
   * PHASE 2 (POST /approve-verification — admin only):
   *   - Admin manually checks bar number at STATE_BAR_LOOKUP[state]
   *   - Confirms license is ACTIVE and attorney is in GOOD STANDING
   *   - Grants bar_verified=1, jtb_verified=1
   *   - Attorney notified by push + email
   *
   * IMPORTANT: The JTB Verified badge MUST NOT be granted automatically.
   * Users facing criminal charges rely on this badge to assess attorney
   * credibility. Automated bypass would constitute deceptive advertising
   * and expose the company to FTC enforcement and state bar complaints.
   */
  try {
    const ctx = await req.user?.role !== 'attorney' ? res.status(403).json({ error: 'Attorney access required' }) : null;
    if (!ctx) return;

    const { bar_number, state } = req.body || {};
    if (!bar_number || !state) {
      return err400(res, 'bar_number and state required');
    }

    // Validate state code
    const VALID_STATES = new Set([
      'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
      'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
      'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
      'VT','VA','WA','WV','WI','WY',
    ]);
    const stateUpper = state.trim().toUpperCase();
    if (!VALID_STATES.has(stateUpper)) {
      return err400(res, 'Invalid state code. Use a 2-letter US state abbreviation (e.g. TN, CA).');
    }

    // Validate bar number format (3–20 chars, alphanumeric)
    const cleanBar = bar_number.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (cleanBar.length < 3 || cleanBar.length > 20) {
      return err400(res, 'Bar number must be 3–20 characters.');
    }

    const { db, user } = ctx;

    // ── Atomic check-then-write using transaction ──────────────────────────────
    // Without a transaction, two concurrent requests could both pass the
    // "already verified" check and both set pending=1. BEGIN IMMEDIATE acquires
    // a write lock so only one request can execute this block at a time.
    // BEGIN IMMEDIATE — acquires write lock to prevent concurrent submissions.
    // If this fails (SQLite busy, WAL checkpoint lock), return 503 rather
    // than silently proceeding without transaction protection.
    try {
      await db.exec('BEGIN IMMEDIATE');
    } catch (e) {
      logger.error('[attorney/verify-bar] BEGIN IMMEDIATE failed — refusing to proceed without lock:', e.message);
      return res.status(503).json({ error: 'Server busy. Please try again in a moment.' });
    }
    let current;
    try {
      current = await db.get(
        'SELECT bar_verified, pending_bar_verification FROM users WHERE id=?',
        [req.user.id]
      );
    } catch (e) { await db.exec('ROLLBACK').catch(() => {}); throw new Error('DB read failed'); }

    if (current?.bar_verified) {
      await db.exec('ROLLBACK').catch(() => {});
      return res.json({ ok: true, status: 'already_verified', message: 'Your bar number is already verified.' });
    }

    // Store bar submission — pending, not verified
    await db.run(
      `UPDATE users
         SET bar_number              = ?,
             bar_state               = ?,
             pending_bar_verification = 1,
             bar_verified             = 0,
             bar_submitted_at         = datetime('now')
       WHERE id = ?`,
      [cleanBar, stateUpper, req.user.id]
    );

    // Mirror to provider record
    const provider = await db.get(
      'SELECT id FROM lawyers WHERE email=? LIMIT 1',
      [user.email || '']
    ).catch(() => null);

    if (provider) {
      await db.run(
        `UPDATE lawyers
           SET bar_number          = ?,
               bar_state           = ?,
               bar_verified         = 0,
               pending_verification = 1
         WHERE id = ?`,
        [cleanBar, stateUpper, provider.id]
      );
    }

    try {
      await db.exec('COMMIT');
    } catch (e) {
      // COMMIT failed — bar verification not persisted despite appearing to succeed
      logger.error('[attorney/verify-bar] COMMIT failed — bar submission lost:', e.message);
      return res.status(500).json({ error: 'Could not save verification. Please try again.' });
    }

    // Build admin lookup link
    const lookupUrl = STATE_BAR_LOOKUP[stateUpper]
      || 'https://www.americanbar.org/tools/find-a-lawyer/';
    const adminUrl  = `${process.env.ADMIN_PANEL_URL || 'https://admin.justicegavel.app'}/verify/${req.user.id}`;

    // Notify admin team
    const { sendEmail } = await import('../services/sendgrid.js');
    await sendEmail({
      to:      process.env.ADMIN_EMAIL || 'admin@justicegavel.app',
      subject: `[JTB Verify] Bar submission — ${cleanBar} (${stateUpper}) from ${user.email}`,
      text: [
        `Attorney email: ${user.email}`,
        `Bar number:     ${cleanBar}`,
        `State:          ${stateUpper}`,
        `Submitted:      ${new Date().toISOString()}`,
        ``,
        `STEP 1 — Look up at official state bar:`,
        lookupUrl,
        ``,
        `Search for: ${cleanBar}`,
        `Confirm status is: ACTIVE / IN GOOD STANDING`,
        ``,
        `STEP 2 — Approve or reject in admin panel:`,
        adminUrl,
        ``,
        `Do NOT approve if: suspended, disbarred, inactive, or name does not match.`,
      ].join('\n'),
      html: `
        <h2>Bar Verification Request</h2>
        <table>
          <tr><td><b>Attorney:</b></td><td>${user.email}</td></tr>
          <tr><td><b>Bar number:</b></td><td>${cleanBar}</td></tr>
          <tr><td><b>State:</b></td><td>${stateUpper}</td></tr>
          <tr><td><b>Submitted:</b></td><td>${new Date().toISOString()}</td></tr>
        </table>
        <p><a href="${lookupUrl}" style="font-size:16px;font-weight:bold">
          → Look up ${cleanBar} at ${stateUpper} State Bar
        </a></p>
        <p style="color:#666">Confirm: ACTIVE and IN GOOD STANDING before approving.</p>
        <p><a href="${adminUrl}" style="background:#042C53;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block">
          Approve or Reject in Admin Panel
        </a></p>
      `,
    }).catch(err => logger.error('[bar-verify email]', err.message));

    return res.json({
      ok:         true,
      status:     'pending_review',
      message:    'Bar number submitted. Our team verifies each submission against your state bar\'s official records. You will receive a notification within 1–2 business days.',
      bar_number: cleanBar,
      state:      stateUpper,
    });
  } catch (e) {
    logger.error('[attorney/verify-bar]', e.message);
    return res.status(500).json({ error: 'Could not submit verification. Please try again.' });
  }
});

// ── POST /approve-verification — Admin grants or rejects JTB Verified ─────────
// Called by the admin team after manually confirming bar status at state bar website.
router.post('/approve-verification', authRequired, routeLimiter, async (req, res) => {
  try {
    const db    = await getDb();
    const admin = await db.get('SELECT role FROM users WHERE id=?', [req.user.id]);
    if (admin?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required.' });
    }

    const { attorney_user_id, approved, rejection_reason, verified_by } = req.body || {};
    if (!attorney_user_id || typeof approved !== 'boolean') {
      return err400(res, 'attorney_user_id (number) and approved (boolean) required');
    }

    const attorney = await db.get('SELECT id, email, phone, name, type, user_type, avatar_url, created_at, bar_number, bar_verified, bar_state, office_id, is_defender, gavel_level, golden_gavel, subscription, push_token, lang, notifs_enabled FROM users WHERE id=?', [attorney_user_id]);
    if (!attorney) return err404(res, 'Attorney not found.');

    const { sendEmail } = await import('../services/sendgrid.js');
    const { sendPushToUser } = await import('../services/pushDelivery.js');

    if (approved) {
      // Grant the JTB Verified badge
      await db.run(
        `UPDATE users
           SET bar_verified              = 1,
               pending_bar_verification   = 0,
               bar_verified_at            = datetime('now'),
               bar_verified_by            = ?
         WHERE id = ?`,
        [verified_by || req.user.id, attorney_user_id]
      );
      await db.run(
        `UPDATE lawyers
           SET bar_verified      = 1,
               jtb_verified      = 1,
               pending_verification = 0
         WHERE email = ?`,
        [attorney.email]
      );
      await sendEmail({
        to:      attorney.email,
        subject: 'Justice Gavel — Bar Verification Approved ✅',
        text:    'Congratulations — your bar number has been verified. The JTB Verified badge is now active on your Justice Gavel profile. Thank you for helping us maintain a trusted network of attorneys.',
      }).catch(() => {});
      await sendPushToUser(attorney_user_id, {
        title: '✅ Bar Verified — JTB Badge Active',
        body:  'Your Justice Gavel JTB Verified badge is now live on your profile.',
        data:  { screen: 'AttorneyDashboard' },
      }).catch(() => {});
    } else {
      // Reject — clear pending, leave bar_verified=0
      await db.run(
        `UPDATE users
           SET pending_bar_verification = 0,
               bar_rejection_reason      = ?
         WHERE id = ?`,
        [rejection_reason || 'Could not verify bar status with the state bar.', attorney_user_id]
      );
      await db.run(
        `UPDATE lawyers SET pending_verification = 0 WHERE email = ?`,
        [attorney.email]
      );
      await sendEmail({
        to:      attorney.email,
        subject: 'Justice Gavel — Bar Verification Update',
        text:    `We were unable to verify your bar number at this time.\n\nReason: ${rejection_reason || 'Could not confirm active status with your state bar.'}\n\nIf you believe this is an error, please contact support@justicegavel.app with your full name, bar number, and state.`,
      }).catch(() => {});
    }

    return res.status(201).json({ ok: true, approved, attorney_user_id });
  } catch (e) {
    logger.error('[attorney/approve-verification]', e.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});


export default router;

// GET /api/attorney/pending-verification (admin view)
router.get('/pending-verification', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const pending = await db.all(
      `SELECT u.id as user_id, u.display_name, u.email, u.bar_number, u.created_at
       FROM users u WHERE u.bar_verified = 0 AND u.bar_number IS NOT NULL
       ORDER BY u.created_at DESC LIMIT 50`
    ).catch(() => []);
    res.json({ pending });
  } catch(e) { res.status(500).json({ error: 'Internal server error.', code: 'server_error' }); }
});
