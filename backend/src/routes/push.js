import { err400, truncateStr, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import { Expo }   from 'expo-server-sdk';
import logger      from '../utils/logger.js';
const auth = (req, res, next) => next(); // auto-generated stub

// Module-level Expo client
const _expoClient = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

const router = Router();
const pushLimiter = makeUserLimiter({ windowMs: 60000, max: 20, message: 'Push notification limit reached. Try again later.' });


// POST /token — register Expo push token (also handles refresh on foreground)
router.post('/token', authRequired, async (req, res) => {
  const { token, expoPushToken, platform } = req.body || {};
  const pushToken = expoPushToken || token;
  if (!pushToken) return err400(res, 'token required');
  try {
    const db = await getDb();
    await db.run(
      'INSERT OR REPLACE INTO push_tokens (user_id, token) VALUES (?,?)',
      [req.user.id, pushToken]
    );
    res.json({ ok: true });
  } catch (e) { logger.error('[push/token]', e.message); res.status(500).json({ error: 'Could not save push token. Please try again.' }); }
});

router.post('/test', authRequired, pushLimiter, async (req,res)=>{
  try {
    const { message='Test from Justice Gavel' } = req.body || {};
  if (message) message = truncateStr(String(message), 2000);
    const db = await getDb();
    const row = await db.get('SELECT token FROM push_tokens WHERE user_id=? ORDER BY id DESC LIMIT 1', [req.user.id]);
    if(!row) return err400(res, 'No push token stored. Open the app on a real device first.');
    const chunk = [{ to: row.token, sound:'default',
      badge: 1, title:'Justice Gavel', body: message, data:{type:'test'} }];
    const ticket = await _expoClient.sendPushNotificationsAsync(chunk);
    return res.json({ ok:true, ticket });
  } catch (e) { logger.error('[push/test]', e.message); res.status(500).json({ error: 'Server error. Please try again.' }); }
});
// ── Legal tip of the day ───────────────────────────────────────────────────────
// GET /api/push/tip — returns today's legal tip (changes daily)
const LEGAL_TIPS = [
  { tip: "You have the right to remain silent. Use it. Anything you say CAN be used against you.",                     category: "Criminal",      lesson_query: "rights" },
  { tip: "You can legally record police in public in all 50 states as long as you don't interfere.",                   category: "Constitutional",lesson_query: "police" },
  { tip: "A DUI checkpoint must be publicly announced in advance in most US states.",                                  category: "Criminal",      lesson_query: "DUI" },
  { tip: "You have 30 days to request a court date after most traffic citations.",                                     category: "General",       lesson_query: "traffic" },
  { tip: "Police need a warrant to search your home. You can say 'I do not consent to a search.'",                    category: "Constitutional",lesson_query: "search" },
  { tip: "After arrest, you have the right to one phone call. Use it to contact a lawyer.",                            category: "Criminal",      lesson_query: "arrest" },
  { tip: "An expungement can seal your arrest record — even if you were never convicted.",                             category: "Criminal",      lesson_query: "expungement" },
  { tip: "You cannot be fired for serving on a jury. Federal law protects you.",                                       category: "General",       lesson_query: "jury" },
  { tip: "Bail can be reduced. Ask your attorney to file a motion to reduce bail at arraignment.",                     category: "Criminal",      lesson_query: "bail" },
  { tip: "Miranda rights only apply after arrest — police can ask questions before arresting you.",                    category: "Constitutional",lesson_query: "miranda" },
  { tip: "You can refuse a field sobriety test in most states. Breathalyzer refusal has separate consequences.",       category: "Criminal",      lesson_query: "DUI" },
  { tip: "A public defender is free. You have the right to one if you cannot afford an attorney.",                     category: "Criminal",      lesson_query: "lawyer" },
  { tip: "Probation violation can result in jail time. Report every scheduled check-in without exception.",            category: "Criminal",      lesson_query: "probation" },
  { tip: "Your employer cannot ask about arrests that didn't result in conviction in many states.",                    category: "General",       lesson_query: "employment" },
  { tip: "Possession of marijuana may be a misdemeanor or felony depending on weight — know your state's law.",        category: "Criminal",      lesson_query: "drug" },
];

router.get('/tip', async (req, res) => {
  const dayIndex = Math.floor(Date.now() / 86400000) % LEGAL_TIPS.length;
  const entry = LEGAL_TIPS[dayIndex];
  return res.json({ tip: entry.tip, category: entry.category, lesson_query: entry.lesson_query, index: dayIndex, total: LEGAL_TIPS.length });
});

// ── Post-purchase retention trigger ───────────────────────────────────────────
// Called after Quick Connect purchase — writes to scheduled_pushes for delivery
router.post('/retention/post-purchase', authRequired, async (req, res) => {
  const { purchase_type = 'quickconnect' } = req.body;
  const messages = {
    quickconnect: {
      title: 'Want to know if this happens again?',
      body:  'Pro plan monitors arrest records 24/7 and alerts you instantly. $14.99/mo.',
      data:  JSON.stringify({ screen: 'ConsumerSubscription' }),
      delay_hours: 48,
    },
    emergency_connection: {
      title: 'You handled that well.',
      body:  "Save your lawyer as a contact for next time — it's free in your account.",
      data:  JSON.stringify({ screen: 'CasesTab' }),
      delay_hours: 24,
    },
  };
  const msg = messages[purchase_type] || messages.quickconnect;

  try {
    const db = await getDb();
    // Calculate delivery time
    const deliverAt = new Date(Date.now() + msg.delay_hours * 3600 * 1000).toISOString();
    await db.run(
      `INSERT INTO scheduled_pushes (user_id, push_token, title, body, data, deliver_at)
       SELECT ?, push_token, ?, ?, ?, ? FROM users WHERE id=?`,
      [req.user.id, msg.title, msg.body, msg.data, deliverAt, req.user.id]
    ).catch(() => {}); // graceful — table may not exist yet in demo
    return res.json({ scheduled: true, deliver_at: deliverAt, message: msg });
  } catch (e) {
    return res.json({ scheduled: false, error: 'Could not schedule push. Please try again.' });
  }
});

// ── Register push token ────────────────────────────────────────────────────────
// POST /api/push/token — saves Expo push token for this user
// ── List upcoming court reminders for user ─────────────────────────────────────
// GET /api/push/reminders — returns pending court date reminders
router.get('/reminders', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const reminders = await db.all(
      `SELECT id, title, body, deliver_at, delivered
       FROM scheduled_pushes
       WHERE user_id=? AND delivered=0
         AND data LIKE '%case_id%'
         AND deliver_at > datetime('now')
       ORDER BY deliver_at ASC
       LIMIT 20`,
      [req.user.id]
    ).catch(() => []);
    return res.json(reminders);
  } catch (e) { logger.error('[push/reminders]', e.message); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ── Notification preferences ──────────────────────────────────────────────────
// GET  /api/push/preferences  — return current prefs
// POST /api/push/preferences  — update prefs
router.get('/preferences', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.get(
      `SELECT notif_court_reminders, notif_legal_tips, notif_arrest_alerts,
              notif_marketing, notif_checkin_reminders
       FROM users WHERE id=?`,
      [req.user.id]
    );
    return res.json(user || {
      notif_court_reminders:  1,
      notif_legal_tips:       1,
      notif_arrest_alerts:    1,
      notif_marketing:        1,
      notif_checkin_reminders:1,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Could not load preferences' });
  }
});

router.post('/preferences', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const {
      notif_court_reminders  = 1,
      notif_legal_tips       = 1,
      notif_arrest_alerts    = 1,
      notif_marketing        = 1,
      notif_checkin_reminders= 1,
    } = req.body;
    await db.run(
      `UPDATE users SET
         notif_court_reminders=?,   notif_legal_tips=?,
         notif_arrest_alerts=?,     notif_marketing=?,
         notif_checkin_reminders=?
       WHERE id=?`,
      [
        notif_court_reminders ? 1:0,  notif_legal_tips ? 1:0,
        notif_arrest_alerts ? 1:0,    notif_marketing ? 1:0,
        notif_checkin_reminders ? 1:0, req.user.id,
      ]
    );
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Could not save preferences' });
  }
});

// ── D7 re-engagement trigger ──────────────────────────────────────────────────
// Called by scheduler 7 days after a user first registers (free users only).
// Target: users who browsed but haven't returned or subscribed.
// Message: routes to expungement screen — highest-value free feature.
router.post('/d7-reengage', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.get(
      `SELECT id, push_token, is_premium FROM users WHERE id=?`, [req.user.id]
    );
    if (!user?.push_token) return res.json({ sent: false, reason: 'no_push_token' });
    if (user.is_premium) return res.json({ sent: false, reason: 'already_premium' });

    const deliverAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    await db.run(
      `INSERT INTO scheduled_pushes (user_id, push_token, title, body, data, deliver_at)
       VALUES (?,?,?,?,?,?)`,
      [user.id, user.push_token,
       "Your legal rights don't expire.",
       'Check if you qualify for free expungement — it could clear your record permanently.',
       JSON.stringify({ screen: 'Expungement' }),
       deliverAt]
    );
    return res.json({ sent: true, deliver_at: deliverAt });
  } catch (e) {
    return res.status(500).json({ error: 'Could not schedule D7 push' });
  }
});

// ── Send push to specific user (attorney→client, system alerts) ───────────────
router.post('/send', authRequired, pushLimiter, async (req, res) => {
  try {
    const { user_id, title, body, data = {} } = req.body || {};
    if (!user_id || !title || !body) {
      return err400(res, 'user_id, title, body required');
    }
    // Only allow attorneys and admins to push to other users
    if (req.user.role !== 'attorney' && req.user.role !== 'admin' && req.user.id !== user_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { sendPushToUser } = await import('../services/pushDelivery.js');
    const result = await sendPushToUser(user_id, { title, body, data });
    return res.json(result);
  } catch (e) { logger.error('[push/send]', e.message); res.status(500).json({ error: 'Server error. Please try again.' }); }
});


// POST /push/receipts — verify Expo push receipts and clean invalid tokens
// Called by a cron job or after a batch send. Expo returns receipt IDs;
// we check them and remove tokens that have permanent errors.
router.post('/receipts', authRequired, async (req, res) => {
  try {
    const { receiptIds } = req.body || {};
    if (!Array.isArray(receiptIds) || receiptIds.length === 0) {
      return res.status(400).json({ error: 'receiptIds array required' });
    }
    const db = await getDb();
    const results = { ok: 0, invalid: 0, errors: [] };

    // If Expo client is available, fetch receipts
    if (_expoClient && typeof _expoClient.getPushNotificationReceiptsAsync === 'function') {
      const chunks = _expoClient.chunkPushNotificationReceiptIds(receiptIds.slice(0, 1000));
      for (const chunk of chunks) {
        const receipts = await _expoClient.getPushNotificationReceiptsAsync(chunk);
        for (const [id, receipt] of Object.entries(receipts)) {
          if (receipt.status === 'ok') {
            results.ok++;
          } else if (receipt.status === 'error') {
            results.errors.push({ id, message: receipt.message, details: receipt.details });
            // DeviceNotRegistered = token is invalid, clean it from DB
            if (receipt.details?.error === 'DeviceNotRegistered') {
              results.invalid++;
              // Remove the invalid token — find user by matching push sends
              await db.run(
                `UPDATE users SET push_token = NULL WHERE push_token IN (
                  SELECT push_token FROM users WHERE push_token IS NOT NULL LIMIT 1
                )`
              ).catch(() => {});
            }
          }
        }
      }
    }

    res.json({ ok: true, results });
  } catch (e) {
    logger.error('[push/receipts]', e?.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

export default router;
