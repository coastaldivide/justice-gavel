/**
 * ARREST DATA RETENTION AND ACCURACY POLICY
 *
 * Arrest records are public information from county booking systems.
 * Justice Gavel republishes this data to help defendants exercise their rights.
 *
 * DATA ACCURACY OBLIGATIONS:
 *   - Charges dropped, dismissed, or expunged MUST update our records.
 *   - Publishing an arrest without its disposition is the false-light fact pattern.
 *   - This system does NOT automatically update when charges are resolved.
 *     That is an identified gap that will be addressed before public launch.
 *
 * RETENTION LIMIT: 90 days from booking date (configurable per jurisdiction).
 * TAKEDOWN PATH: DELETE /alerts/record/:recordId files a request that staff
 *                review (GET/POST /alerts/takedown-requests…); see below.
 * JURISDICTION BLOCKLIST: CA, IL, GA, OR (commercial republication restrictions).
 *
 * States restricting commercial mugshot/arrest-record republication:
 *   California: Civil Code §1798.91.1
 *   Illinois:   765 ILCS 1075 (Right of Publicity Act)
 *   Georgia:    O.C.G.A. §35-1-19
 *   Oregon:     ORS §646A.808
 */


/**
 * LEGAL NOTE — ARREST DATA REPUBLICATION
 * Several states restrict commercial republication of booking/mugshot data:
 *   California: Civil Code §1798.91.1 (mugshot removal obligations)
 *   Illinois:   Right of Publicity Act (misleading commercial use)
 *   Georgia:    O.C.G.A. §35-1-19 (mugshot website restrictions)
 *   Oregon:     ORS §646A.808
 *
 * Right of publicity and commercial-use provisions apply in CA, IL, GA, OR.
Mitigations implemented:
 *   1. Alerts are delivered ONLY to the defendant or their authorized contacts
 *   2. No public display of arrest records — user-scoped only
 *   3. Removal on request after staff review (see DELETE /alerts/record route)
 *   4. Alerts contain court-record data only, not mugshot images
 *
 * Remaining risk: Some CA/IL provisions may apply regardless of display scope.
 * Get legal opinion before enabling public-facing arrest alerts.
 */
import { logIgnored } from '../utils/ignored.js';
import { err400, safeInt, sanitizeStr } from '../utils/routeHelpers.js';
import { isStaff, requireStaff } from '../utils/staff.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { Router }       from 'express';
import { authRequired } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import { googleMapsLink } from '../services/geolink.js';
import { sendSms, toE164 } from '../services/sms.js';
import { sendEmail, emailLive } from '../services/email.js';
import { resolveLang, msg as i18nMsg } from '../i18n/index.js';
import logger from '../utils/logger.js';

const alertsLimiter = makeUserLimiter({ windowMs: 60000, max: 3, message: 'Too many alerts. Please wait 1 minute.' });
const router = Router();

const ALERT_CATEGORIES = ['emergency', 'court_reminder', 'missed_checkin', 'arrest'];
const MAX_ALERT_CONTACTS = 3;   // the app saves up to three emergency contacts
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Send one alert to one contact. Never throws: { contact, method, delivered, reason? }. */
async function deliverAlert(contact, text, subject) {
  if (EMAIL_RE.test(contact)) {
    if (!emailLive()) return { contact, method: 'email', delivered: false, reason: 'email_not_configured' };
    try {
      await sendEmail({ to: contact, subject, text });
      return { contact, method: 'email', delivered: true };
    } catch {
      return { contact, method: 'email', delivered: false, reason: 'send_failed' };
    }
  }
  if (!toE164(contact)) return { contact, method: 'sms', delivered: false, reason: 'invalid_contact' };
  const r = await sendSms({ to: contact, body: text });
  if (r.ok) return { contact, method: 'sms', delivered: true };
  return { contact, method: 'sms', delivered: false, reason: r.skipped ? r.reason : 'send_failed' };
}

// POST /api/alerts — text / e-mail the person's emergency contacts.
// The answer says, per contact, whether the alert actually went out: with no
// SMS provider (Twilio) or e-mail provider (Resend) configured nothing is sent,
// and the app then opens the phone's own messages app with `message`.
// Location is optional (permission denied must never block an SOS).
router.post('/', authRequired, alertsLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const lang = resolveLang(req);
    const userName = typeof body.userName === 'string' ? sanitizeStr(body.userName, 80).trim() : '';
    const contacts = Array.isArray(body.contacts)
      ? [...new Set(body.contacts.filter(c => typeof c === 'string').map(c => c.trim()).filter(Boolean))].slice(0, MAX_ALERT_CONTACTS)
      : [];
    if (!contacts.length) return err400(res, i18nMsg(lang, 'alerts.contacts_required'));
    const lat = Number(body.lat), lng = Number(body.lng);
    const hasLoc = body.lat != null && body.lng != null && Number.isFinite(lat) && Number.isFinite(lng)
      && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    const category = ALERT_CATEGORIES.includes(body.category) ? body.category : 'emergency';
    const name = userName || i18nMsg(lang, 'alerts.someone');
    const text = i18nMsg(lang, `alerts.${category}${hasLoc ? '' : '_no_location'}`,
      { name, link: hasLoc ? googleMapsLink(lat, lng) : '' });
    const subject = i18nMsg(lang, 'alerts.subject');

    const db = await getDb();
    db.run(
      `INSERT INTO alert_log (user_id, category, message, lat, lng, contact_count, sent_at)
       VALUES (?,?,?,?,?,?,NOW())`,
      [req.user.id, category, text, hasLoc ? lat : null, hasLoc ? lng : null, contacts.length]
    ).catch(logIgnored('routes/alerts'));

    const results = await Promise.all(contacts.map(c => deliverAlert(c, text, subject)));
    await Promise.all(results.map(r => db.run(
      'INSERT INTO alerts (user_name,lat,lng,contact,method,status,message) VALUES (?,?,?,?,?,?,?)',
      [name, hasLoc ? lat : null, hasLoc ? lng : null, r.contact, r.method, r.delivered ? 'sent' : (r.reason || 'not_sent'), text]
    ).catch(logIgnored('routes/alerts'))));
    const sent = results.filter(r => r.delivered).length;
    res.json({ ok: sent > 0, sent, total: results.length, results, message: text, language: lang });
  } catch (e) { logger.error('[alerts]', e.message); res.status(500).json({ error: 'Alert failed' }); }
});

// ── GET /alerts/family-contacts — retrieve stored emergency contacts ─────────
router.get('/family-contacts', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const contacts = await db.all(
      'SELECT id, name, phone, email, relationship FROM family_contacts WHERE user_id = ? ORDER BY created_at LIMIT 100',
      [req.user.id]
    );
    return res.json({ contacts });
  } catch (e) {
    logger?.warn('[alerts/family-contacts]', e?.message);
    return res.json({ contacts: [] });
  }
});

// ── POST /alerts/family-contacts — add/update emergency contact ─────────────
router.post('/family-contacts', authRequired, async (req, res) => {
  const { name, phone, email, relationship } = req.body;
  if (!name?.trim() || (!phone?.trim() && !email?.trim())) {
    return res.status(400).json({ error: 'name and phone or email required' });
  }
  try {
    const db = await getDb();
    // Max 3 emergency contacts per user
    const count = await db.get('SELECT COUNT(*) as n FROM family_contacts WHERE user_id = ?', [req.user.id]);
    if ((count?.n || 0) >= 3) return res.status(400).json({ error: 'Maximum 3 emergency contacts' });
    const r = await db.run(
      'INSERT INTO family_contacts (user_id, name, phone, email, relationship, created_at) VALUES (?,?,?,?,?,NOW())',
      [req.user.id, name.trim(), phone?.trim() || null, email?.trim() || null, relationship?.trim() || null]
    );
    return res.json({ id: r.lastID, name, phone, email, relationship });
  } catch (e) {
    logger?.warn('[alerts/family-contacts/add]', e?.message);
    return res.status(500).json({ error: 'Failed to add contact' });
  }
});


// ── GET /alerts/history — user's sent alert log ───────────────────────────
router.get('/history', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const alerts = await db.all(
      `SELECT id, category, message, lat, lng, contact_count, sent_at
       FROM alert_log WHERE user_id = ? ORDER BY sent_at DESC LIMIT 50`,
      [req.user.id]
    ).catch(() => []);
    return res.json({ alerts, count: alerts.length });
  } catch {
    return res.status(500).json({ error: 'Could not fetch alert history' });
  }
});


// ── Arrest-record takedowns and dispositions ─────────────────────────────────
// Required by: CA Civil Code §1798.91.1, and general privacy best practice.
//
// Who may do what (arrest records have no link to a user account, so a
// signed-in user cannot be verified as the person named in a record):
//   • Any signed-in user may REQUEST a takedown. The request is stored in
//     arrest_takedown_log as 'pending' with the reason and a contact; the record
//     stays as it is until staff review it.
//   • Staff (users.role admin / super_admin / staff, or users.is_admin = 1 —
//     read from the database, not the token) approve or reject requests, may
//     suppress a record directly, and record case dispositions.
// Previously any signed-in user could suppress, or set the disposition of, any
// arrest record by id with no check at all.
//
// Suppressed rows are hidden from every user view and automated job by
// utils/arrestVisibility.js. The source booking data is public record kept by
// county courts; we manage only our copy.
const TAKEDOWN_RELATIONSHIPS = ['self', 'family', 'attorney', 'other'];
const takedownLimiter = makeUserLimiter({ windowMs: 60 * 60 * 1000, max: 5, message: 'Too many takedown requests. Please try again later.' });
const staffOnly = requireStaff(getDb);

async function suppressRecord(db, recordId, reason) {
  return await db.run(
    `UPDATE arrest_records SET suppressed = 1, suppressed_at = NOW(), suppressed_reason = ?
      WHERE id = ?`,
    [reason, recordId]
  );
}

// ── DELETE /alerts/record/:recordId — takedown request (staff: immediate) ──────
router.delete('/record/:recordId', authRequired, takedownLimiter, async (req, res) => {
  const recordId = safeInt(req.params.recordId);
  if (!recordId) return err400(res, 'Invalid record id');
  const body         = req.body || {};
  const reason       = sanitizeStr(String(body.reason || ''), 2000);
  const contact      = sanitizeStr(String(body.contact || req.user.email || req.user.phone || ''), 200) || null;
  const relationship = TAKEDOWN_RELATIONSHIPS.includes(body.relationship) ? body.relationship : 'self';

  try {
    const db = await getDb();
    const record = await db.get('SELECT id FROM arrest_records WHERE id = ?', [recordId]);
    if (!record) return res.status(404).json({ error: 'Record not found' });

    if (await isStaff(db, req.user)) {
      await suppressRecord(db, recordId, 'takedown_request');
      await db.run(
        `INSERT INTO arrest_takedown_log
           (arrest_id, record_id, requested_by, requested_at, status, reason, requestor, relationship,
            reviewed_by, reviewed_at, taken_down_by, taken_down_at)
         VALUES (?, ?, ?, NOW(), 'approved', ?, ?, ?, ?, NOW(), ?, NOW())`,
        [recordId, recordId, req.user.id, reason || 'staff takedown', contact, relationship, req.user.id, req.user.id]
      );
      logger.info({ msg: '[alerts/takedown] record suppressed by staff', recordId, userId: req.user.id });
      return res.json({
        success: true,
        status:  'suppressed',
        message: 'Record suppressed from Justice Gavel systems. Source booking records are maintained by county courts and are outside our control.',
      });
    }

    if (!reason.trim()) {
      return err400(res, 'Please tell us why this record should be removed (reason).');
    }

    const existing = await db.get(
      `SELECT id FROM arrest_takedown_log WHERE arrest_id = ? AND requested_by = ? AND status = 'pending'`,
      [recordId, req.user.id]
    );
    if (existing) {
      return res.status(202).json({ success: true, status: 'pending', request_id: existing.id, duplicate: true,
        message: 'Your takedown request is already pending review.' });
    }

    const r = await db.run(
      `INSERT INTO arrest_takedown_log
         (arrest_id, record_id, requested_by, requested_at, status, reason, requestor, relationship)
       VALUES (?, ?, ?, NOW(), 'pending', ?, ?, ?)`,
      [recordId, recordId, req.user.id, reason, contact, relationship]
    );
    logger.info({ msg: '[alerts/takedown] request filed for review', recordId, userId: req.user.id });
    return res.status(202).json({
      success:    true,
      status:     'pending',
      request_id: r.lastID || null,
      message:    'Takedown request received. Our team reviews requests and will contact you; the record stays visible until the request is approved.',
    });
  } catch (e) {
    logger.error('[alerts/takedown]', e?.message);
    return res.status(500).json({ error: 'Could not process takedown request' });
  }
});

// ── GET /alerts/takedown-requests — staff review queue ─────────────────────────
router.get('/takedown-requests', authRequired, staffOnly, async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT t.id, t.arrest_id, t.requested_by, t.requested_at, t.status, t.reason, t.requestor,
              t.relationship, t.reviewed_by, t.reviewed_at, t.review_note,
              a.name AS record_name, a.county, a.state, a.booking_date, a.suppressed
         FROM arrest_takedown_log t
         LEFT JOIN arrest_records a ON a.id = t.arrest_id
        WHERE t.status = ?
        ORDER BY t.requested_at ASC
        LIMIT 200`,
      [status]
    );
    return res.json({ status, requests: rows, count: rows.length });
  } catch (e) {
    logger.error('[alerts/takedown-requests]', e?.message);
    return res.status(500).json({ error: 'Could not load takedown requests' });
  }
});

// ── POST /alerts/takedown-requests/:id/approve | /reject — staff decision ──────
async function decideTakedown(req, res, decision) {
  const id = safeInt(req.params.id);
  if (!id) return err400(res, 'Invalid request id');
  const note = sanitizeStr(String(req.body?.note || ''), 1000) || null;
  try {
    const db  = await getDb();
    const row = await db.get('SELECT id, arrest_id, status FROM arrest_takedown_log WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Takedown request not found' });
    if (row.status !== 'pending') return res.status(409).json({ error: `Request already ${row.status}`, status: row.status });

    // Claim the request first so two reviewers cannot both act on it.
    const claim = await db.run(
      `UPDATE arrest_takedown_log
          SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_note = ?,
              taken_down_by = ?, taken_down_at = CASE WHEN ? = 'approved' THEN NOW() ELSE NULL END
        WHERE id = ? AND status = 'pending'`,
      [decision, req.user.id, note, decision === 'approved' ? req.user.id : null, decision, id]
    );
    if (!claim?.changes) return res.status(409).json({ error: 'Request was already reviewed' });

    if (decision === 'approved') {
      try {
        await suppressRecord(db, row.arrest_id, 'takedown_request');
      } catch (e) {
        await db.run(
          `UPDATE arrest_takedown_log SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL,
                  taken_down_by = NULL, taken_down_at = NULL WHERE id = ?`, [id]
        ).catch(logIgnored('routes/alerts'));   // best effort: the original error is reported below
        throw e;
      }
    }
    logger.info({ msg: `[alerts/takedown] request ${decision}`, requestId: id, arrestId: row.arrest_id, reviewer: req.user.id });
    return res.json({ success: true, request_id: id, arrest_id: row.arrest_id, status: decision });
  } catch (e) {
    logger.error('[alerts/takedown-decide]', e?.message);
    return res.status(500).json({ error: 'Could not record the decision' });
  }
}
router.post('/takedown-requests/:id/approve', authRequired, staffOnly, (req, res) => decideTakedown(req, res, 'approved'));
router.post('/takedown-requests/:id/reject',  authRequired, staffOnly, (req, res) => decideTakedown(req, res, 'rejected'));

// ── POST /alerts/record/:recordId/disposition — staff record the case outcome ──
// Arrest data without disposition = false-light defamation risk. Users who want
// a disposition corrected file a takedown/correction request (reason) above.
router.post('/record/:recordId/disposition', authRequired, staffOnly, async (req, res) => {
  const { disposition, disposition_date, court } = req.body || {};
  const VALID = ['dismissed','acquitted','not_guilty','expunged','sealed','charges_reduced','convicted','pending'];
  if (!VALID.includes(disposition)) {
    return res.status(400).json({ error: 'Invalid disposition', valid: VALID });
  }
  if (disposition_date != null && disposition_date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(disposition_date))) {
    return err400(res, 'disposition_date must be YYYY-MM-DD');
  }
  const recordId = safeInt(req.params.recordId);
  if (!recordId) return err400(res, 'Invalid record id');
  try {
    const db = await getDb();
    const r = await db.run(
      `UPDATE arrest_records SET disposition = ?, disposition_date = ?, disposition_court = ?,
                                 disposition_added_at = NOW()
         WHERE id = ?`,
      [disposition, disposition_date || null, court ? sanitizeStr(String(court), 200) : null, recordId]
    );
    if (!r?.changes) return res.status(404).json({ error: 'Record not found' });
    logger.info({ msg: '[alerts/disposition] recorded', recordId, disposition, userId: req.user.id });
    return res.json({ success: true, message: 'Disposition recorded. This will appear alongside the arrest record.' });
  } catch (e) {
    logger.error('[alerts/disposition]', e?.message);
    return res.status(500).json({ error: 'Could not record disposition' });
  }
});

export default router;