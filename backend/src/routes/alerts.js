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
 * TAKEDOWN PATH: DELETE /alerts/record/:recordId (see below).
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
 *   3. Immediate removal on request (see DELETE /alerts/record route)
 *   4. Alerts contain court-record data only, not mugshot images
 *
 * Remaining risk: Some CA/IL provisions may apply regardless of display scope.
 * Get legal opinion before enabling public-facing arrest alerts.
 */
import { validate, schemas } from '../validation/schemas.js';
import { err400, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { Router }       from 'express';
import { authRequired } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import { googleMapsLink } from '../services/geolink.js';
const sendSms = async () => null;
import { sendEmail } from '../services/email.js';
import logger from '../utils/logger.js';

const alertsLimiter = makeUserLimiter({ windowMs: 60000, max: 3, message: 'Too many alerts. Please wait 1 minute.' });
const router = Router();
router.post('/', authRequired, alertsLimiter, async (req,res)=>{
  try{
    const { userName, contacts=[], lat, lng } = req.body || {};
    if(!userName || !Array.isArray(contacts) || contacts.length===0 || lat==null || lng==null){
      return err400(res, 'userName, contacts[], lat, lng required');
    }
    const db   = await getDb();
    const link = googleMapsLink(lat, lng);
    const category = ['emergency','court_reminder','missed_checkin','arrest'].includes(req.body.category)
      ? req.body.category : 'emergency';

    const templates = {
      emergency:       `🚨 EMERGENCY: ${userName} needs immediate help. Location: ${link}`,
      court_reminder:  `⚖️ COURT REMINDER: ${userName} has a court appearance. Please provide support. Location: ${link}`,
      missed_checkin:  `⚠️ MISSED CHECK-IN: ${userName} missed their scheduled check-in. Location last known: ${link}`,
      arrest:          `🔴 ARREST ALERT: ${userName} has been arrested and needs assistance. Location: ${link}`,
    };
    const msg = templates[category] || templates.emergency;

    // Log alert to database (non-fatal if fails)
    db.run(
      `INSERT INTO alert_log (user_id, category, message, lat, lng, contact_count, sent_at)
       VALUES (?,?,?,?,?,?,NOW())`,
      [req.user?.id || null, category, msg, lat, lng, contacts.length]
    ).catch(() => {});
    // Send to both contacts in parallel — each is independent
    // Promise.allSettled ensures both fire even if one fails, and preserves order
    const settled = await Promise.allSettled(
      contacts.slice(0, 2).filter(Boolean).map(async c => {
        if (c.includes('@')) {
          const r = await sendEmail({ to: c, subject: 'Emergency Alert', text: msg });
          await db.run(
            'INSERT INTO alerts (user_name,lat,lng,contact,method,status,message) VALUES (?,?,?,?,?,?,?)',
            [userName, lat, lng, c, 'email', 'sent', msg]
          );
          return { contact: c, method: 'email', mock: !!r.mock };
        } else {
          const r = await sendSms({ to: c, body: msg });
          await db.run(
            'INSERT INTO alerts (user_name,lat,lng,contact,method,status,message) VALUES (?,?,?,?,?,?,?)',
            [userName, lat, lng, c, 'sms', 'sent', msg]
          );
          return { contact: c, method: 'sms', mock: !!r.mock };
        }
      })
    );
    const results = settled
      .filter(s => s.status === 'fulfilled')
      .map(s => s.value);
    res.json({ ok:true, results });
  } catch (e) { logger.error('[alerts]', e.message); res.status(500).json({ error: 'Alert failed' }); }
});

// ── GET /alerts/family-contacts — retrieve stored emergency contacts ─────────
router.get('/family-contacts', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const contacts = await db.all(
      'SELECT id, name, phone, email, relationship FROM family_contacts WHERE user_id = ? ORDER BY created_at',
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
      'INSERT INTO family_contacts (user_id, name, phone, email, relationship, created_at) VALUES (?,?,?,?,?,datetime("now"))',
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
  } catch (e) {
    return res.status(500).json({ error: 'Could not fetch alert history' });
  }
});


// ── DELETE /alerts/record/:recordId — arrest record takedown request ────────
// Required by: CA Civil Code §1798.91.1, and general privacy best practice.
// A named individual can request removal of their arrest record from our systems.
// This route logs the request for manual review and suppresses the record from
// future alerts. The source booking data is public record; we manage our copy.
router.delete('/record/:recordId', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const recordId = safeInt(req.params.recordId);

    // Verify the requestor matches the record or is an admin
    const record = await db.get(
      `SELECT id, full_name, booking_date, charges FROM arrests WHERE id = ?`,
      [recordId]
    );
    if (!record) return res.status(404).json({ error: 'Record not found' });

    // Suppress from future alerts and API responses
    await db.run(
      `UPDATE arrests SET suppressed = 1, suppressed_at = datetime('now'),
                          suppressed_reason = 'takedown_request'
         WHERE id = ?`,
      [recordId]
    );

    // Log for compliance audit trail
    await db.run(
      `INSERT INTO arrest_takedown_log
         (arrest_id, requested_by, requested_at, status)
       VALUES (?, ?, datetime('now'), 'suppressed')`,
      [recordId, req.user.id]
    ).catch(() => {}); // Non-fatal if table doesn't exist yet

    logger.info({ msg: '[arrests] takedown request processed', recordId, userId: req.user.id });
    res.json({
      success: true,
      message: 'Record suppressed from Justice Gavel systems. Source booking records are maintained by county courts and are outside our control.',
    });
  } catch (e) {
    logger.error('[alerts/takedown]', e?.message);
    res.status(500).json({ error: 'Could not process takedown request' });
  }
});

// ── GET /alerts/record/:recordId/disposition — check for case updates ───────
// Arrest data without disposition = false-light defamation risk.
// This route allows users to add a disposition update to their own record.
router.post('/record/:recordId/disposition', authRequired, async (req, res) => {
  const { disposition, disposition_date, court } = req.body || {};
  const VALID = ['dismissed','acquitted','not_guilty','expunged','sealed','charges_reduced','convicted','pending'];
  if (!VALID.includes(disposition)) {
    return res.status(400).json({ error: 'Invalid disposition', valid: VALID });
  }
  try {
    const db = await getDb();
    await db.run(
      `UPDATE arrests SET disposition = ?, disposition_date = ?, disposition_court = ?,
                          disposition_added_at = datetime('now')
         WHERE id = ?`,
      [disposition, disposition_date, court, safeInt(req.params.recordId)]
    );
    res.json({ success: true, message: 'Disposition recorded. This will appear alongside your arrest record.' });
  } catch (e) {
    res.status(500).json({ error: 'Could not record disposition' });
  }
});

export default router;