/**
 * routes/me.js — things about the signed-in person, mounted at /api/me.
 *
 *   GET /api/me/bail-agent   the "Your bail agent" card (B6): for each active check-in enrollment
 *                            linked to this account (routes/checkins.js links an enrollment whose
 *                            VERIFIED phone matches the account the first time the person looks),
 *                            the agency name and phone, the next court date, the next check-in due,
 *                            and — when the agent attached a Bond Desk bond to that enrollment — the
 *                            bond's outstanding balance (read-only, from the bond's ledger).
 *
 *                            Also `phone_verified` and `verify_prompt` (true when links made before
 *                            phone verification are held for this account until it verifies its
 *                            phone: "Verify your phone to see your bail agent's details").
 *   GET  /api/me/phone            { phone, phone_verified, verified_at, sms_available, pending }
 *   POST /api/me/phone/verify     { phone } — text a 6-digit code (services/phoneVerification.js)
 *   POST /api/me/phone/confirm    { code } — verify; links matching enrollments
 *
 * Only the person's own enrollments are read (enrollment.user_id = the caller). An enrollment is
 * linked only through the account's VERIFIED phone (routes/checkins.js claimMatching; the app does
 * not verify e-mail, so e-mail never links). A bond is shown only through an enrollment linked to
 * the caller and owned by the same agent — never matched to an account by contact details alone.
 */
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import logger from '../utils/logger.js';
import { resolveLang, msg } from '../i18n/index.js';
import { claimMatching } from './checkins.js';
import { checkinState, planCheckinReminder } from '../services/checkinReminders.js';
import { agencyFor } from '../services/bondDesk/core.js';
import { bondMoney } from '../services/bondDesk/money.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { phoneStatus, startVerification, confirmVerification, verifiedPhone, VerifyError } from '../services/phoneVerification.js';

const router = Router();
const OPEN_BONDS = ['prospect', 'active', 'forfeited'];

/** The soonest of the dates that is today or later ('YYYY-MM-DD'), or null. */
export function nextDate(dates, today) {
  const ok = dates.map((d) => (d == null ? null : String(d).slice(0, 10))).filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today).sort();
  return ok[0] || null;
}

router.get('/bail-agent', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    for (const id of await claimMatching(db, req.user.id)) await planCheckinReminder(db, id).catch(() => null);
    const rows = await db.all(
      `SELECT id, bondsman_id, user_id, defendant_name, court_date, check_in_freq, active, created_at, channel, time_zone
         FROM checkin_enrollments WHERE user_id = ? AND active = 1 AND bondsman_id IS NOT NULL ORDER BY created_at DESC LIMIT 10`, [req.user.id]);
    const agents = [];
    for (const e of rows) {
      const st = await checkinState(db, e);
      const a = await agencyFor(db, e.bondsman_id);
      const bond = await db.get(
        `SELECT id, status, court_date, plan_charged_cents FROM bd_bonds
          WHERE checkin_enrollment_id = ? AND agent_id = ? AND status IN (${OPEN_BONDS.map(() => '?').join(',')})
          ORDER BY id DESC LIMIT 1`, [e.id, e.bondsman_id, ...OPEN_BONDS]);
      let balance = null;
      if (bond) {
        const [charges, payments, installments] = await Promise.all([
          db.all('SELECT amount_cents, voided_at FROM bd_charges WHERE bond_id = ?', [bond.id]),
          db.all('SELECT amount_cents, voided_at FROM bd_payments WHERE bond_id = ?', [bond.id]),
          db.all('SELECT id, due_on, amount_cents FROM bd_installments WHERE bond_id = ? ORDER BY due_on, id', [bond.id]),
        ]);
        const m = bondMoney({ charges, payments, installments, planChargedCents: bond.plan_charged_cents }, st.today);
        balance = { balance_cents: Math.max(0, m.balance_cents), next_payment: m.next_due && m.balance_cents > 0
          ? { due_on: m.next_due.due_on, amount_cents: m.next_due.amount_cents - m.next_due.covered_cents } : null };
      }
      agents.push({
        enrollment_id: Number(e.id),
        agency: { name: String(a.agency || a.agent_name || '').trim() || null, phone: a.phone || null },
        next_court_date: nextDate([e.court_date, bond?.court_date], st.today),
        check_in: { frequency: e.check_in_freq, next_due: st.next_due, checked_in_today: st.last_day === st.today, done_for_period: st.done,
          today: st.today, time_zone: st.tz },
        bond: bond ? { status: bond.status, ...balance } : null,
      });
    }
    const verified = !!(await verifiedPhone(db, req.user.id));
    const held = verified ? null : await db.get(
      'SELECT COUNT(*)::int AS n FROM checkin_enrollments WHERE held_user_id = ? AND user_id IS NULL AND active = 1', [req.user.id]);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ agents, phone_verified: verified, verify_prompt: !verified && Number(held?.n || 0) > 0 });
  } catch (e) {
    logger.error({ err: e.message }, '[me/bail-agent]');
    res.status(500).json({ error: msg(resolveLang(req), 'checkin.err.server'), code: 'server_error' });
  }
});

// ── Phone verification (security fix, migration 40) ──────────────────────────
const phoneLimiter = makeUserLimiter({ windowMs: 15 * 60_000, max: 20, message: (req) => msg(resolveLang(req), 'phone.err.too_many_codes') });
function phoneFail(req, res, e, where) {
  const lang = resolveLang(req);
  if (e instanceof VerifyError) return res.status(e.status).json({ error: msg(lang, `phone.err.${e.code}`, e.params), code: e.code, ...(e.params || {}) });
  logger.error({ err: e.message }, `[me/phone${where}]`);
  return res.status(500).json({ error: msg(lang, 'phone.err.server'), code: 'server_error' });
}

router.get('/phone', authRequired, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await phoneStatus(await getDb(), req.user.id));
  } catch (e) { phoneFail(req, res, e, ''); }
});

router.post('/phone/verify', authRequired, phoneLimiter, async (req, res) => {
  if (typeof req.body?.phone !== 'string') return res.status(400).json({ error: msg(resolveLang(req), 'phone.err.bad_phone'), code: 'bad_phone' });
  try {
    const db = await getDb();
    const lang = resolveLang(req);
    res.json(await startVerification(db, req.user.id, req.body?.phone, { lang }));
  } catch (e) { phoneFail(req, res, e, '/verify'); }
});

router.post('/phone/confirm', authRequired, phoneLimiter, async (req, res) => {
  if (!['string', 'number'].includes(typeof req.body?.code)) return res.status(400).json({ error: msg(resolveLang(req), 'phone.err.bad_code_format'), code: 'bad_code_format' });
  try {
    const db = await getDb();
    const r = await confirmVerification(db, req.user.id, req.body?.code, { claim: claimMatching });
    for (const id of r.linked) await planCheckinReminder(db, id).catch(() => null);
    res.json({ verified: true, phone: r.phone, linked: r.linked.length, message: msg(resolveLang(req), 'phone.verified') });
  } catch (e) { phoneFail(req, res, e, '/confirm'); }
});

export default router;
