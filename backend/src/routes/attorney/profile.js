/**
 * attorney/profile.js — the attorney's own profile, dashboard counts and weekly availability.
 *
 *   GET /api/attorney/profile               profile + real counts (nothing estimated)
 *   GET /api/attorney/profile/availability  { schedule, note }
 *   PUT /api/attorney/profile/availability  { schedule: { mon: ['morning', …] }, note }
 *
 * Availability is stored on the attorney's own attorney_profiles row; the
 * directory listing (lawyers) is never written. The bar number is changed only
 * through POST /api/attorney/verify-bar (which restarts the verification).
 */
import { Router }       from 'express';
import { authRequired } from '../../middleware/auth.js';
import logger           from '../../utils/logger.js';
import { requireAttorney } from './_helpers.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';
import { resolveLang, msg } from '../../i18n/index.js';
import { activeSubscriptions } from '../../services/entitlements.js';
import { safeJson } from '../../utils/routeHelpers.js';

const routeLimiter = makeUserLimiter({ windowMs: 60_000, max: 30 });
const router = Router();
const n = (row, k = 'n') => Number(row?.[k] || 0);
const fail = (req, res, key, e) => { logger.error(`[attorney/profile] ${key}`, e?.message); res.status(500).json({ error: msg(resolveLang(req), `attorney.err.${key}`), code: 'server_error' }); };

/** The directory listing linked to this account (approved listing claim), or null. */
export async function linkedListing(db, userId) {
  return await db.get(
    `SELECT l.id, l.name FROM lawyers l
      WHERE l.id = (SELECT lawyer_id FROM attorney_profiles WHERE user_id = ? AND lawyer_id IS NOT NULL ORDER BY id LIMIT 1)
         OR l.user_id = ?
      ORDER BY l.id LIMIT 1`, [userId, userId]);
}

router.get('/profile', authRequired, async (req, res) => {
  try {
    const ctx = await requireAttorney(req, res);
    if (!ctx) return;
    const { db } = ctx;
    const uid = req.user.id;
    const u = await db.get(
      `SELECT id, display_name, email, bar_number, bar_state, bar_verified, pending_bar_verification, bar_verified_at,
              bar_submitted_at, bar_rejection_reason, office_id, is_defender
         FROM users WHERE id = ?`, [uid]);
    const listing = await linkedListing(db, uid);
    const [office, active, pending, hearings, unreadCase, unreadDirect, motions, cle, consults, rating, subs] = await Promise.all([
      u.office_id ? db.get('SELECT office_name FROM office_members WHERE office_id = ? AND office_name IS NOT NULL ORDER BY id LIMIT 1', [u.office_id]) : null,
      db.get(`SELECT COUNT(*)::int AS n FROM case_assignments WHERE defender_id = ? AND status = 'active'`, [uid]),
      db.get(`SELECT COUNT(*)::int AS n FROM case_assignments WHERE defender_id = ? AND status = 'pending'`, [uid]),
      db.get(`SELECT COUNT(*)::int AS n FROM court_dates cd
                JOIN case_assignments ca ON ca.case_id = cd.case_id AND ca.defender_id = ? AND ca.status = 'active'
               WHERE cd.deleted_at IS NULL AND (cd.court_date - CURRENT_DATE) BETWEEN 0 AND 6`, [uid]),
      db.get(`SELECT COUNT(*)::int AS n FROM case_messages cm
                JOIN case_assignments ca ON ca.case_id = cm.case_id AND ca.defender_id = ? AND ca.status = 'active'
               WHERE cm.read_at IS NULL AND cm.sender_type = 'user' AND cm.deleted_at IS NULL`, [uid]),
      db.get(`SELECT COUNT(*)::int AS n FROM messages WHERE recipient_id = ? AND read_at IS NULL`, [uid]),
      db.get(`SELECT COUNT(*)::int AS n FROM motions WHERE user_id = ?`, [uid]),
      db.get(`SELECT COALESCE(SUM(credit_hours), 0) AS n FROM cle_completions WHERE user_id = ?`, [uid]),
      listing ? db.get(`SELECT COUNT(*)::int AS n FROM consultation_bookings WHERE lawyer_id = ? AND status = 'confirmed'
                         AND COALESCE(starts_at, date_slot::timestamptz) >= NOW()`, [listing.id]) : null,
      listing ? db.get(`SELECT AVG(rating) AS avg, COUNT(*)::int AS cnt FROM reviews
                         WHERE entity_type = 'lawyer' AND entity_id = ? AND COALESCE(status, 'published') = 'published'`, [listing.id]) : null,
      activeSubscriptions(db, uid),
    ]);
    const plan = subs.find(s => s.provider_type === 'lawyer') || null;
    res.json({
      id: Number(u.id), name: u.display_name, email: u.email,
      bar_number: u.bar_number, bar_state: u.bar_state,
      bar_verified: Number(u.bar_verified) === 1,
      pending_bar_verification: Number(u.pending_bar_verification) === 1,
      bar_verified_at: u.bar_verified_at, bar_submitted_at: u.bar_submitted_at,
      bar_rejection_reason: Number(u.pending_bar_verification) === 1 || Number(u.bar_verified) === 1 ? null : (u.bar_rejection_reason || null),
      office_id: u.office_id ? Number(u.office_id) : null, office_name: office?.office_name || null,
      is_defender: Number(u.is_defender) === 1,
      listing: listing ? { id: Number(listing.id), name: listing.name } : null,
      plan: plan ? { tier: plan.tier, status: plan.status } : null,
      stats: {
        active_cases: n(active), pending_assignments: n(pending), hearings_this_week: n(hearings),
        unread_messages: n(unreadCase) + n(unreadDirect), motions_generated: n(motions),
        cle_hours: Math.round(Number(cle?.n || 0) * 10) / 10,
        upcoming_consultations: consults ? n(consults) : null,
        avg_rating: rating?.cnt ? Math.round(Number(rating.avg) * 10) / 10 : null,
        review_count: rating ? n(rating, 'cnt') : null,
      },
    });
  } catch (e) { fail(req, res, 'profile', e); }
});

// ── Weekly availability ───────────────────────────────────────────────────────
const DAYS  = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const SLOTS = ['morning', 'afternoon', 'evening'];

router.get('/profile/availability', authRequired, async (req, res) => {
  try {
    const ctx = await requireAttorney(req, res);
    if (!ctx) return;
    const row = await ctx.db.get('SELECT availability_schedule, availability_note FROM attorney_profiles WHERE user_id = ? ORDER BY id LIMIT 1', [req.user.id]);
    const raw = row?.availability_schedule ? safeJson(row.availability_schedule, {}) : {};
    const schedule = {};
    for (const d of DAYS) if (Array.isArray(raw?.[d])) schedule[d] = raw[d].filter(s => SLOTS.includes(s));
    res.json({ schedule, note: row?.availability_note || '' });
  } catch (e) { fail(req, res, 'availability', e); }
});

router.put('/profile/availability', authRequired, routeLimiter, async (req, res) => {
  try {
    const ctx = await requireAttorney(req, res);
    if (!ctx) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.schedule !== undefined && (typeof body.schedule !== 'object' || body.schedule === null || Array.isArray(body.schedule))) {
      return res.status(400).json({ error: msg(resolveLang(req), 'attorney.err.bad_schedule'), code: 'bad_schedule' });
    }
    const clean = {};
    for (const d of DAYS) {
      const v = body.schedule?.[d];
      if (Array.isArray(v)) clean[d] = [...new Set(v.filter(s => SLOTS.includes(s)))];
    }
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';
    const { db } = ctx;
    const r = await db.run('UPDATE attorney_profiles SET availability_schedule = ?, availability_note = ?, updated_at = NOW() WHERE user_id = ?',
      [JSON.stringify(clean), note, req.user.id]);
    if (!r.changes) {
      await db.run('INSERT INTO attorney_profiles (user_id, availability_schedule, availability_note, updated_at) VALUES (?, ?, ?, NOW())',
        [req.user.id, JSON.stringify(clean), note]);
    }
    res.json({ ok: true, schedule: clean, note });
  } catch (e) { fail(req, res, 'availability', e); }
});

export default router;
