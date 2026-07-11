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
    const msg = `Emergency: ${userName} needs help. Location: ${link}`;
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

export default router;
