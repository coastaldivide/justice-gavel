/**
 * attorney/profile.js — Attorney profile and availability schedule
 */
import { err400, err401, err403, err404, err409, err422, err500, err502,
         safeInt, sanitizeStr, validateEmail } from '../../utils/routeHelpers.js';
import { Router }       from 'express';
import { authRequired } from '../../middleware/auth.js';
import { getDb }        from '../../db/index.js';
import logger           from '../../utils/logger.js';
import { sanitiseField, sanitiseProfileFields, STATE_BAR_LOOKUP } from './_helpers.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';


const routeLimiter = makeUserLimiter(30, 60_000); // 30 req/min per user


const router = Router();


// GET /api/attorney/profile
router.get('/profile', authRequired, async (req, res) => {
  try {
    const ctx = await req.user?.role !== 'attorney' ? res.status(403).json({ error: 'Attorney access required' }) : null;
    if (!ctx) return;
    const { db } = ctx;
    const user = ctx.user;

    const [activeCases, completedMotions, cleHours, avgRating] = await Promise.all([
      db.get(`SELECT COUNT(*) as n FROM case_assignments WHERE defender_id=? AND status='active'`, [req.user.id]).catch(() => ({n:0})),
      db.get(`SELECT COUNT(*) as n FROM motions WHERE user_id=?`, [req.user.id]).catch(() => ({n:0})),
      db.get(`SELECT COALESCE(SUM(credit_hours),0) as hrs FROM cle_completions WHERE user_id=?`, [req.user.id]).catch(() => ({hrs:0})),
      await db.get(`SELECT AVG(rating) as avg, COUNT(*) as cnt FROM reviews WHERE entity_type='lawyer' AND entity_id=?`, [req.user.id]).catch(() => ({avg:null,cnt:0})),
    ]);

    return res.json({
      id:            user.id,
      name:          user.name,
      email:         user.email,
      bar_number:       user.bar_number,
      bar_state:        user.bar_state,
      bar_verified:     !!user.bar_verified,
      pending_bar_verification: !!user.pending_bar_verification,
      office_id:        user.office_id,
      is_defender:      user.is_defender,
      gavel_level:      user.gavel_level || 0,
      subscription_tier: user.subscription || 'basic',
      office_name:      user.office_name,
      bio:              user.bio,
      phone:            user.phone,
      specialties:      user.specialties ? (() => { try { return JSON.parse(user.specialties); } catch { return []; } })().catch?.() || [] : [],
      stats: {
        active_cases:       activeCases.n,
        motions_generated:  completedMotions.n,
        cle_hours_earned:   avgRating.hrs || cleHours.hrs,
        avg_rating:         avgRating.avg ? Math.round(avgRating.avg * 10) / 10 : null,
        review_count:       avgRating.cnt,
      },
    });
  } catch (e) { logger.error('[attorney/profile/get]', e.message); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// PATCH /api/attorney/profile
router.patch('/profile', authRequired, routeLimiter, async (req, res) => {
  try {
    const ctx = await req.user?.role !== 'attorney' ? res.status(403).json({ error: 'Attorney access required' }) : null;
    if (!ctx) return;
    const { db } = ctx;
    const { bar_number, is_defender } = req.body;
    const updates = [];
    const params  = [];
    if (bar_number !== undefined) { updates.push('bar_number=?');  params.push(bar_number); }
    if (is_defender !== undefined){ updates.push('is_defender=?'); params.push(is_defender ? 1 : 0); }
    if (!updates.length) return err400(res, 'No fields to update');
    params.push(req.user.id);
    await db.run(`UPDATE users SET ${updates.join(',')} WHERE id=?`, params);
    return res.json({ ok: true });
  } catch (e) { logger.error('[attorney/profile/patch]', e.message); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ── Weekly availability schedule ──────────────────────────────────────────────

// GET /api/attorney/profile/availability
router.get('/profile/availability', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const row = await db.get(
      'SELECT weekly_availability, availability_note FROM lawyers WHERE user_id=?',
      [req.user.id]
    );
    const schedule = row?.weekly_availability
      ? JSON.parse(row.weekly_availability)
      : {};
    return res.json({ schedule, note: row?.availability_note || '' });
  } catch (e) {
    logger.error('[attorney/availability/get]', e?.message);
    return res.status(500).json({ error: 'Could not load availability.' });
  }
});

// PUT /api/attorney/profile/availability
router.put('/profile/availability', authRequired, routeLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const { schedule = {}, note = '' } = req.body;

    // Validate: only known day/slot values accepted
    const DAYS  = ['mon','tue','wed','thu','fri','sat','sun'];
    const SLOTS = ['morning','afternoon','evening'];
    const clean = {};
    for (const day of DAYS) {
      if (Array.isArray(schedule[day])) {
        clean[day] = schedule[day].filter((s) => SLOTS.includes(s));
      }
    }

    await db.run(
      `UPDATE lawyers SET weekly_availability=?, availability_note=?,
       updated_at=datetime('now') WHERE user_id=?`,
      [JSON.stringify(clean), String(note).slice(0, 200), req.user.id]
    );
    return res.json({ ok: true, schedule: clean });
  } catch (e) {
    logger.error('[attorney/availability/put]', e?.message);
    return res.status(500).json({ error: 'Could not save availability.' });
  }
});

;

// POST /api/attorney/verify-bar — attorney submits bar number for verification
// Sets bar_verified=0 (pending) initially; JTB admin reviews and flips to 1
// ── State Bar Lookup URLs — for human verification step ───────────────────────
// Every URL is the official state bar attorney search page.
// Admin team uses these during the 1–2 business day review period.
// Last verified: April 2026

export default router;
