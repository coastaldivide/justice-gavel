import { err400, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { Router }       from 'express';
import { authRequired } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import { googleMapsLink } from '../services/geolink.js';
import { sendSms } from '../services/twilio.js';
import { sendEmail } from '../services/sendgrid.js';
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
export default router;
