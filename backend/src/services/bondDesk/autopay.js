/**
 * services/bondDesk/autopay.js — automatic payment-plan collection (A5, ⚖ counsel question 3.2:
 * BOND_AUTOPAY_ENABLED, off in production until counsel answers). docs/BOND_DESK.md "Automatic payments".
 *
 * 1. The agent sends the payer (defendant or an indemnitor) a personal link (text and/or e-mail;
 *    32 random bytes, only the SHA-256 is stored, same pattern as signing links).
 * 2. On the link page the payer reads the consent (amounts, dates, how to stop, "all payments are
 *    final") and agrees; the snapshot (text, version, language, schedule, IP, browser, time) is
 *    stored; Stripe Checkout in setup mode on the AGENCY's connected account saves the card
 *    (SetupIntent). Only Stripe ids, card brand and last 4 are stored.
 * 3. Job `bd-autopay` (hourly; each installment is charged once per attempt on its due day, from
 *    08:00 in the agency's zone): for every installment of an active autopay due today that the
 *    payer agreed to (same date and amount), an off-session PaymentIntent on the agency's account
 *    with idempotency key bd-inst-<installmentId>-<attempt>, for the part not yet paid and never
 *    more than the bond's balance; 99¢ application fee (charges of $1 or more).
 *      succeeded → posted with the same function as typed-in payments (numbered receipt, oldest
 *                  first coverage), exactly once (unique PaymentIntent id; webhook replays and the
 *                  job + webhook race post nothing twice); receipt e-mailed to the payer
 *      declined  → text + e-mail to the payer and the agent; tried once more 3 days later
 *      bank asks the payer to confirm (3-D Secure) → the off-session charge is cancelled and the
 *                  payer is texted the same link, where "Confirm payment" opens Stripe Checkout
 * 4. The payer ("Stop automatic payments" on the link) or the agent can stop it at any time; the
 *    card is detached from the agency's Stripe customer.
 */
import { stripeConfigured } from '../../config.js';
import { AUTOPAY_FEE_CENTS } from '../../routes/billing/plans.js';
import { msg, normalizeLang, stripeLocale } from '../../i18n/index.js';
import { fitSms } from '../smsText.js';
import { sendPushToUser } from '../pushDelivery.js';
import { DEFAULT_TIME_ZONE, isValidTimeZone, todayInZone, addDays, zonedParts } from '../../utils/timezone.js';
import { agencyFor, hashToken, newToken, sendAgentTextRecord, sendAgentEmail, maskPhone, withoutOptOut } from './core.js';
import { planStatus, liveTotal, money, usDate } from './money.js';
import { LedgerError, postPayment, sendReceipt } from './payments.js';
import { appUrl, chargeableAccount, stripeOr503 } from './connect.js';
import { logIgnored } from '../../utils/ignored.js';
import logger from '../../utils/logger.js';

export const AUTOPAY_CONSENT_VERSION = 'autopay-2026-10';
export const AUTOPAY_LINK_DAYS = 30;
export const RETRY_DAYS = 3;
export const CHARGE_FROM_HOUR = 8;          // local time in the agency's zone
const MIN_CHARGE_CENTS = 50;               // Stripe's minimum card charge
const STUCK_MINUTES = 10;                  // a 'processing' attempt without an answer is re-sent with the same key

/** ⚖ counsel 3.2: explicit true/false wins; unset → off in production, on elsewhere (tests). */
export function autopayEnabled({ flag = process.env.BOND_AUTOPAY_ENABLED, appEnv = process.env.APP_ENV, nodeEnv = process.env.NODE_ENV } = {}) {
  const v = String(flag ?? '').trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return String(appEnv || '').toLowerCase() !== 'production' && String(nodeEnv || '').toLowerCase() !== 'production';
}

export const autopayLink = (token) => `${appUrl()}/autopay/${token}`;
export const AUTOPAY_TOKEN_RE = /^[A-Za-z0-9_-]{40,60}$/;
export const feeFor = (amountCents) => (amountCents >= 100 ? AUTOPAY_FEE_CENTS : 0);

const agentTz = async (db, agentId) => {
  const u = await db.get('SELECT timezone FROM users WHERE id = ?', [agentId]);
  return isValidTimeZone(u?.timezone) ? u.timezone : DEFAULT_TIME_ZONE;
};

/** The bond's ledger now: { balance, plan (installments with coverage), charged, planInSync }. */
export async function bondLedger(db, bondId, today) {
  const [charges, payments, installments, bond] = await Promise.all([
    db.all('SELECT amount_cents, voided_at FROM bd_charges WHERE bond_id = ?', [bondId]),
    db.all('SELECT amount_cents, voided_at FROM bd_payments WHERE bond_id = ?', [bondId]),
    db.all('SELECT id, due_on, amount_cents FROM bd_installments WHERE bond_id = ? ORDER BY due_on, id', [bondId]),
    db.get('SELECT plan_charged_cents FROM bd_bonds WHERE id = ?', [bondId]),
  ]);
  const charged = liveTotal(charges);
  const paid = liveTotal(payments);
  const plan = planStatus(installments, paid, today);
  const scheduled = plan.reduce((s, i) => s + i.amount_cents, 0);
  return { balance: charged - paid, plan, charged, planInSync: plan.length > 0 && scheduled === charged && Number(bond?.plan_charged_cents) === charged };
}

/** The installments the payer agrees to: the unpaid part of every installment due today or later. */
export const scheduleFrom = (plan, today) => plan.filter((i) => i.status !== 'paid' && i.due_on >= today)
  .map((i) => ({ due_on: i.due_on, amount_cents: i.amount_cents - i.covered_cents, installment_cents: i.amount_cents }));

/**
 * The consent text, word for word what the page shows in the payer's language (and what is
 * stored): amounts, dates, how to stop, "all payments are final".
 */
export function consentText(lang, { agency, phone, defendant, schedule }) {
  const l = normalizeLang(lang) || 'en';
  const lines = [msg(l, 'bd.autopay.consent_intro', { agency, defendant })];
  for (const s of schedule) lines.push(`• ${usDate(s.due_on)}: ${money(s.amount_cents)}`);
  lines.push(msg(l, 'bd.autopay.consent_rules', { days: RETRY_DAYS }));
  lines.push(msg(l, 'bd.autopay.consent_stop', { agency, phone: phone || '—' }));
  lines.push(msg(l, 'bd.autopay.consent_card', { agency }));
  lines.push(msg(l, 'bd.autopay.consent_final'));
  return lines.join('\n');
}

// ── The agent's side ─────────────────────────────────────────────────────────

const ATTEMPT_COLS = 'id, installment_id, due_on, attempt, amount_cents, fee_cents, status, failure_code, failure_message, retry_on, payment_id, created_at, updated_at';
const pubAttempt = (a) => ({ ...a, id: Number(a.id), installment_id: Number(a.installment_id), attempt: Number(a.attempt), amount_cents: Number(a.amount_cents),
  fee_cents: Number(a.fee_cents), payment_id: a.payment_id == null ? null : Number(a.payment_id) });
const pubAutopay = (r) => (r ? {
  id: Number(r.id), status: r.status, payer_role: r.payer_role, indemnitor_id: r.indemnitor_id == null ? null : Number(r.indemnitor_id),
  payer_name: r.payer_name, payer_phone_masked: r.payer_phone ? maskPhone(r.payer_phone) : null, payer_email: r.payer_email,
  card: r.card_last4 ? { brand: r.card_brand, last4: r.card_last4 } : null, consent_at: r.consent_at, consent_version: r.consent_version,
  consent_schedule: r.consent_schedule || null, link_expires_at: r.link_expires_at, activated_at: r.activated_at,
  stopped_at: r.stopped_at, stopped_by: r.stopped_by, stop_reason: r.stop_reason, created_at: r.created_at,
} : null);

/** Does the plan still match what the payer agreed to? (dates and amounts of every unpaid installment) */
function scheduleMatches(consented, plan, today) {
  if (!Array.isArray(consented)) return false;
  const agreed = new Set(consented.map((s) => `${s.due_on}|${s.installment_cents}`));
  return plan.filter((i) => i.status !== 'paid' && i.due_on >= today).every((i) => agreed.has(`${i.due_on}|${i.amount_cents}`));
}

/** GET /bond-desk/bonds/:id/autopay → { enabled, autopay, attempts, plan_changed } */
export async function autopayForBond(db, { agentId, bondId }) {
  const row = await db.get(`SELECT * FROM bd_autopay WHERE bond_id = ? AND agent_id = ? ORDER BY (status <> 'stopped') DESC, id DESC LIMIT 1`, [bondId, agentId]);
  const attempts = await db.all(`SELECT ${ATTEMPT_COLS} FROM bd_autopay_attempts WHERE bond_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`, [bondId]);
  let planChanged = false;
  if (row?.status === 'active') {
    const today = todayInZone(await agentTz(db, agentId));
    planChanged = !scheduleMatches(row.consent_schedule, (await bondLedger(db, bondId, today)).plan, today);
  }
  return { enabled: autopayEnabled(), autopay: pubAutopay(row), attempts: attempts.map(pubAttempt), plan_changed: planChanged, fee_cents: AUTOPAY_FEE_CENTS };
}

/**
 * Send the payer a personal link to set up automatic payments. → { autopay, link, delivery }
 * to: 'defendant' | 'indemnitor' (+ indemnitorId); deliver: 'sms' | 'email' | 'both' | 'none'.
 */
export async function sendAutopayLink(db, { agentId, bondId, to, indemnitorId, deliver, consentConfirmed, lang }) {
  const account = await chargeableAccount(db, agentId);
  const bond = await db.get('SELECT * FROM bd_bonds WHERE id = ? AND agent_id = ?', [bondId, agentId]);
  if (!bond) throw new LedgerError(404, 'not_found');
  if (['exonerated', 'surrendered', 'forfeiture_paid', 'cancelled'].includes(bond.status)) throw new LedgerError(409, 'bond_closed');
  const today = todayInZone(await agentTz(db, agentId));
  const l = await bondLedger(db, bondId, today);
  if (!l.plan.length) throw new LedgerError(409, 'no_plan_to_collect');
  if (!l.planInSync) throw new LedgerError(409, 'plan_out_of_sync');
  if (l.balance <= 0 || !scheduleFrom(l.plan, today).length) throw new LedgerError(409, 'nothing_owed');
  let person = { name: bond.defendant_name, phone: bond.defendant_phone, email: bond.defendant_email };
  if (to === 'indemnitor') {
    const i = await db.get('SELECT id, full_name, phone, email FROM bd_indemnitors WHERE id = ? AND bond_id = ?', [indemnitorId, bondId]);
    if (!i) throw new LedgerError(404, 'not_found');
    person = { name: i.full_name, phone: i.phone, email: i.email };
  }
  if ((deliver === 'sms' || deliver === 'both') && consentConfirmed !== true) throw new LedgerError(400, 'consent_required');
  const token = newToken();
  const row = await db.transaction(async (tx) => {
    const open = await tx.get(`SELECT id, status FROM bd_autopay WHERE bond_id = ? AND status IN ('link_sent','active') FOR UPDATE`, [bondId]);
    if (open?.status === 'active') throw new LedgerError(409, 'autopay_active');
    if (open) await tx.run(`UPDATE bd_autopay SET status = 'stopped', stopped_at = NOW(), stopped_by = 'agent', stop_reason = 'replaced by a new link', updated_at = NOW() WHERE id = ?`, [open.id]);
    return await tx.get(
      `INSERT INTO bd_autopay (bond_id, agent_id, payer_role, indemnitor_id, payer_name, payer_phone, payer_email, sms_consent_at, lang, token_hash,
                               link_expires_at, stripe_account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW() + (? || ' days')::interval, ?) RETURNING *`,
      [bondId, agentId, to, to === 'indemnitor' ? indemnitorId : null, person.name, person.phone || null, person.email || null,
        consentConfirmed === true && person.phone ? new Date().toISOString() : null, normalizeLang(lang) || 'en', hashToken(token),
        String(AUTOPAY_LINK_DAYS), account.stripe_account_id]);
  });
  const link = autopayLink(token);
  const a = await agencyFor(db, agentId);
  const p = { agency: a.agency || a.agent_name, defendant: bond.defendant_name, link, phone: a.phone || '' };
  const delivery = { sms: null, email: null };
  if (deliver === 'sms' || deliver === 'both') {
    delivery.sms = person.phone
      ? (await sendAgentTextRecord(db, { agentId, bondId, purpose: 'autopay_link', to: person.phone,
        body: fitSms((f) => msg(row.lang, 'bd.sms.autopay_link', f), p, [['defendant', 6], ['agency', 12]], { lang: row.lang }) })).status
      : 'skipped';
  }
  if (deliver === 'email' || deliver === 'both') {
    delivery.email = await sendAgentEmail({ to: person.email, subject: msg(row.lang, 'bd.email.autopay_link_subject', p), text: msg(row.lang, 'bd.email.autopay_link_body', p) });
  }
  return { autopay: pubAutopay(row), link, delivery };
}

/** Stop automatic payments (agent, payer or system). The card is detached on the agency's Stripe account. */
export async function stopAutopay(db, { autopayId, by, reason = null }) {
  const row = await db.get(
    `UPDATE bd_autopay SET status = 'stopped', stopped_at = NOW(), stopped_by = ?, stop_reason = ?, updated_at = NOW()
      WHERE id = ? AND status IN ('link_sent','active') RETURNING *`, [by, reason ? String(reason).slice(0, 300) : null, autopayId]);
  if (!row) throw new LedgerError(409, 'autopay_not_active');
  await db.run(`UPDATE bd_autopay_attempts SET status = 'cancelled', updated_at = NOW() WHERE autopay_id = ? AND status = 'action_needed'`, [autopayId]);
  if (row.stripe_payment_method_id && stripeConfigured()) {
    try { await stripeOr503().paymentMethods.detach(row.stripe_payment_method_id, {}, { stripeAccount: row.stripe_account_id }); } catch (e) {
      logger.warn({ err: e?.message }, '[bd-autopay] card not detached (stopped anyway)');
    }
  }
  if (by === 'payer') {
    const a = await agencyFor(db, row.agent_id);
    const b = await db.get('SELECT defendant_name FROM bd_bonds WHERE id = ?', [row.bond_id]);
    await alertAgent(db, row.agent_id, row.bond_id, 'stopped', { payer: row.payer_name, defendant: b?.defendant_name || '' }, a);
  }
  return pubAutopay(row);
}

// ── The payer's page (public, by link) ───────────────────────────────────────

/** Resolve the link → the autopay row (404 link_invalid / 410 link_expired). */
export async function autopayByToken(db, token) {
  if (!AUTOPAY_TOKEN_RE.test(String(token || ''))) throw new LedgerError(404, 'link_invalid');
  const row = await db.get('SELECT * FROM bd_autopay WHERE token_hash = ?', [hashToken(token)]);
  if (!row) throw new LedgerError(404, 'link_invalid');
  if (row.status === 'link_sent' && new Date(row.link_expires_at) <= new Date()) throw new LedgerError(410, 'link_expired');
  if (row.status === 'stopped' && row.stopped_at && Date.now() - new Date(row.stopped_at).getTime() > 60 * 86400_000) throw new LedgerError(410, 'link_expired');
  return row;
}

/** What the link page shows. A Checkout session the payer finished is picked up here too (webhook delay). */
export async function autopayView(db, token, { lang } = {}) {
  let row = await autopayByToken(db, token);
  if (row.status === 'link_sent' && row.setup_session_id && stripeConfigured()) {
    try {
      const s = await stripeOr503().checkout.sessions.retrieve(row.setup_session_id, {}, { stripeAccount: row.stripe_account_id });
      if (s?.status === 'complete') { await completeSetup(db, { session: s, account: row.stripe_account_id }); row = await autopayByToken(db, token); }
    } catch (e) { logger.warn({ err: e?.message }, '[bd-autopay] setup session not read'); }
  }
  const a = await agencyFor(db, row.agent_id);
  const bond = await db.get('SELECT defendant_name FROM bd_bonds WHERE id = ?', [row.bond_id]);
  const today = todayInZone(a.tz);
  const l = await bondLedger(db, row.bond_id, today);
  const showLang = normalizeLang(lang) || row.lang;
  const schedule = row.status === 'active' && Array.isArray(row.consent_schedule) ? row.consent_schedule : scheduleFrom(l.plan, today);
  const action = await db.get(`SELECT id, amount_cents, due_on FROM bd_autopay_attempts WHERE autopay_id = ? AND status = 'action_needed' ORDER BY id DESC LIMIT 1`, [row.id]);
  return {
    enabled: autopayEnabled(),
    agency: { name: a.agency || a.agent_name, phone: a.phone || null },
    payer_name: row.payer_name, defendant_name: bond?.defendant_name || '',
    status: row.status, stopped_by: row.stopped_by,
    card: row.card_last4 ? { brand: row.card_brand, last4: row.card_last4 } : null,
    balance_cents: Math.max(0, l.balance),
    schedule: schedule.map((s) => ({ due_on: s.due_on, amount_cents: Number(s.amount_cents) })),
    consent: { version: AUTOPAY_CONSENT_VERSION, lang: showLang,
      text: consentText(showLang, { agency: a.agency || a.agent_name, phone: a.phone, defendant: bond?.defendant_name || '', schedule }) },
    action_needed: action ? { amount_cents: Math.min(Number(action.amount_cents), Math.max(0, l.balance)), due_on: action.due_on } : null,
    can_start: row.status === 'link_sent' && l.balance > 0 && scheduleFrom(l.plan, today).length > 0,
  };
}

/**
 * The payer agreed: store the consent snapshot and open Stripe Checkout (setup mode) on the
 * agency's account. → { url }
 */
export async function startSetup(db, token, { agree, lang, ip, userAgent, consentVersion }) {
  if (agree !== true) throw new LedgerError(400, 'consent_required');
  if (consentVersion && consentVersion !== AUTOPAY_CONSENT_VERSION) throw new LedgerError(409, 'consent_changed');
  const row = await autopayByToken(db, token);
  if (row.status !== 'link_sent') throw new LedgerError(409, row.status === 'active' ? 'autopay_active' : 'autopay_not_active');
  const account = await chargeableAccount(db, row.agent_id);
  if (account.stripe_account_id !== row.stripe_account_id) throw new LedgerError(409, 'payments_not_set_up');
  const a = await agencyFor(db, row.agent_id);
  const bond = await db.get('SELECT defendant_name FROM bd_bonds WHERE id = ?', [row.bond_id]);
  const today = todayInZone(a.tz);
  const l = await bondLedger(db, row.bond_id, today);
  const schedule = scheduleFrom(l.plan, today);
  if (!l.planInSync) throw new LedgerError(409, 'plan_out_of_sync');
  if (l.balance <= 0 || !schedule.length) throw new LedgerError(409, 'nothing_owed');
  const shown = normalizeLang(lang) || row.lang;
  const text = consentText(shown, { agency: a.agency || a.agent_name, phone: a.phone, defendant: bond?.defendant_name || '', schedule });
  const stripe = stripeOr503();
  const opts = { stripeAccount: row.stripe_account_id };
  let customer = row.stripe_customer_id;
  if (!customer) {
    const c = await stripe.customers.create({ name: row.payer_name, email: row.payer_email || undefined, phone: row.payer_phone || undefined,
      metadata: { bd_autopay_id: String(row.id), bd_bond_id: String(row.bond_id) } }, { ...opts, idempotencyKey: `bd-autopay-customer-${row.id}` });
    customer = c.id;
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'setup', customer, payment_method_types: ['card'], locale: stripeLocale(shown),
    success_url: `${autopayLink(token)}?saved=1`, cancel_url: autopayLink(token),
    metadata: { bd_kind: 'autopay_setup', bd_autopay_id: String(row.id) },
    setup_intent_data: { description: `Automatic payments to ${a.agency || a.agent_name} — bail bond for ${bond?.defendant_name || ''}`.slice(0, 200),
      metadata: { bd_kind: 'autopay_setup', bd_autopay_id: String(row.id) } },
  }, opts);
  await db.run(
    `UPDATE bd_autopay SET stripe_customer_id = ?, setup_session_id = ?, consent_text = ?, consent_version = ?, consent_lang = ?, consent_ip = ?,
            consent_user_agent = ?, consent_at = NOW(), consent_schedule = ?::jsonb, updated_at = NOW() WHERE id = ? AND status = 'link_sent'`,
    [customer, session.id, text, AUTOPAY_CONSENT_VERSION, shown, ip || null, userAgent ? String(userAgent).slice(0, 300) : null, JSON.stringify(schedule), row.id]);
  return { url: session.url };
}

/** Checkout (setup) finished: save the payment method and turn autopay on. Idempotent. */
export async function completeSetup(db, { session, account }) {
  const row = await db.get('SELECT * FROM bd_autopay WHERE setup_session_id = ?', [session.id]);
  if (!row || row.status !== 'link_sent' || (account && account !== row.stripe_account_id)) return null;
  const stripe = stripeOr503();
  const siId = typeof session.setup_intent === 'string' ? session.setup_intent : session.setup_intent?.id;
  if (!siId) return null;
  const si = await stripe.setupIntents.retrieve(siId, { expand: ['payment_method'] }, { stripeAccount: row.stripe_account_id });
  if (si?.status !== 'succeeded' || !si.payment_method) return null;
  const pm = typeof si.payment_method === 'string' ? await stripe.paymentMethods.retrieve(si.payment_method, {}, { stripeAccount: row.stripe_account_id }) : si.payment_method;
  const r = await db.get(
    `UPDATE bd_autopay SET status = 'active', stripe_payment_method_id = ?, card_brand = ?, card_last4 = ?, activated_at = NOW(), updated_at = NOW()
      WHERE id = ? AND status = 'link_sent' AND consent_at IS NOT NULL RETURNING id, agent_id, bond_id, payer_name`,
    [pm.id, pm.card?.brand || null, /^\d{4}$/.test(String(pm.card?.last4 || '')) ? pm.card.last4 : null, row.id]);
  if (r) {
    const b = await db.get('SELECT defendant_name FROM bd_bonds WHERE id = ?', [r.bond_id]);
    await alertAgent(db, r.agent_id, r.bond_id, 'active', { payer: r.payer_name, defendant: b?.defendant_name || '' });
  }
  return r ? Number(r.id) : null;
}

/** "Confirm payment" after the bank asked for it: a Checkout payment on the agency's account. → { url } */
export async function startActionPayment(db, token, { lang } = {}) {
  const row = await autopayByToken(db, token);
  if (row.status !== 'active') throw new LedgerError(409, 'autopay_not_active');
  const att = await db.get(`SELECT * FROM bd_autopay_attempts WHERE autopay_id = ? AND status = 'action_needed' ORDER BY id DESC LIMIT 1`, [row.id]);
  if (!att) throw new LedgerError(409, 'nothing_to_confirm');
  const a = await agencyFor(db, row.agent_id);
  const l = await bondLedger(db, row.bond_id, todayInZone(a.tz));
  const inst = l.plan.find((i) => Number(i.id) === Number(att.installment_id));
  const amount = Math.min(inst ? inst.amount_cents - inst.covered_cents : Number(att.amount_cents), l.balance);
  if (amount < MIN_CHARGE_CENTS) {
    await db.run(`UPDATE bd_autopay_attempts SET status = 'cancelled', failure_code = 'nothing_owed', updated_at = NOW() WHERE id = ?`, [att.id]);
    throw new LedgerError(409, 'nothing_owed');
  }
  const stripe = stripeOr503();
  const opts = { stripeAccount: row.stripe_account_id };
  // One Checkout session per attempt (review finding 1): a second click, another tab or a refresh
  // gets the session already open for this amount. A paid one is never offered again; an open one
  // for another amount (a payment was recorded since) is expired before a new one is made.
  if (att.action_session_id) {
    const prev = await stripe.checkout.sessions.retrieve(att.action_session_id, {}, opts).catch(() => null);
    if (prev?.status === 'complete' || prev?.payment_status === 'paid') throw new LedgerError(409, 'payment_received');
    if (prev?.status === 'open' && Number(prev.amount_total) === amount && prev.url) return { url: prev.url };
    if (prev?.status === 'open') {
      await stripe.checkout.sessions.expire(prev.id, {}, opts).catch((e) => logger.warn({ err: e?.message }, '[bd-autopay] expire session'));
    }
  }
  const bond = await db.get('SELECT defendant_name FROM bd_bonds WHERE id = ?', [row.bond_id]);
  const shown = normalizeLang(lang) || row.lang;
  const fee = feeFor(amount);
  // the key is the same for requests that arrive together (→ the same session), new after an expiry
  const idempotencyKey = `bd-action-${att.id}-${att.action_session_id || 'first'}-${amount}`;
  const session = await stripe.checkout.sessions.create({
    mode: 'payment', customer: row.stripe_customer_id || undefined,
    locale: stripeLocale(shown),
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amount,
      product_data: { name: `${a.agency || a.agent_name} — bail bond payment for ${bond?.defendant_name || ''}`.slice(0, 200) } } }],
    payment_intent_data: { ...(fee ? { application_fee_amount: fee } : {}), description: `Payment plan installment due ${att.due_on}`,
      metadata: { bd_kind: 'autopay', bd_attempt_id: String(att.id), bd_autopay_id: String(row.id), bd_bond_id: String(row.bond_id), bd_agent_id: String(row.agent_id) } },
    metadata: { bd_kind: 'autopay', bd_attempt_id: String(att.id) },
    success_url: `${autopayLink(token)}?paid=1`, cancel_url: autopayLink(token),
  }, { ...opts, idempotencyKey });
  await db.run(`UPDATE bd_autopay_attempts SET action_session_id = ?, amount_cents = ?, fee_cents = ?, updated_at = NOW()
                 WHERE id = ? AND status = 'action_needed'`, [session.id, amount, fee, att.id]);
  return { url: session.url };
}

// ── Charging (job bd-autopay) ────────────────────────────────────────────────

async function alertAgent(db, agentId, bondId, kind, params, agency = null) {
  const u = await db.get('SELECT preferred_language FROM users WHERE id = ?', [agentId]).catch(() => null);
  const lang = normalizeLang(u?.preferred_language) || 'en';
  const title = msg(lang, `bd.autopay.agent_${kind}_title`, params);
  const bodyText = msg(lang, `bd.autopay.agent_${kind}_body`, params);
  await sendPushToUser(Number(agentId), { title, body: bodyText, data: { type: 'bd_autopay', screen: 'BondDetail', bond_id: Number(bondId) } }).catch(logIgnored('services/bondDesk/autopay'));
  const a = agency || await agencyFor(db, agentId);
  await sendAgentEmail({ to: a.email, subject: title, text: `${bodyText}\n\n${appUrl()}/bond-desk/bond/${bondId}` });
  return { a, lang };
}

/**
 * Post a successful automatic charge (job or webhook), once per PaymentIntent. → payment | null
 * The money was taken, so it is always posted (taken: true). A second successful payment for an
 * attempt that is already paid (review finding 1: e.g. an older Checkout page paid as well) is
 * posted too — never dropped — and the agent is alerted to it.
 */
export async function recordAutopaySuccess(db, { attemptId, pi }) {
  const att = await db.get('SELECT * FROM bd_autopay_attempts WHERE id = ?', [attemptId]);
  if (!att || !pi?.id) return null;
  const ap = await db.get('SELECT * FROM bd_autopay WHERE id = ?', [att.autopay_id]);
  const tz = await agentTz(db, ap.agent_id);
  const amount = Number(pi.amount_received || pi.amount || att.amount_cents);
  const out = await db.transaction(async (tx) => {
    const cur = await tx.get('SELECT payment_id FROM bd_autopay_attempts WHERE id = ? FOR UPDATE', [attemptId]);
    const r = await postPayment(tx, {
      agentId: Number(ap.agent_id), bondId: Number(ap.bond_id), amountCents: amount, method: 'card', payerName: ap.payer_name,
      reference: `Automatic payment${ap.card_last4 ? ` (card ending ${ap.card_last4})` : ''}${cur.payment_id ? ' — second payment for one installment' : ''}`,
      receivedOn: todayInZone(tz), stripePiId: pi.id, source: 'autopay', taken: true,
    });
    if (r.duplicate) return r;   // this PaymentIntent was posted already (webhook replay, job + webhook)
    if (cur.payment_id) return { ...r, second: true };
    await tx.run(`UPDATE bd_autopay_attempts SET status = 'succeeded', payment_id = ?, stripe_pi_id = ?, failure_code = NULL, failure_message = NULL, updated_at = NOW() WHERE id = ?`,
      [r.payment.id, pi.id, attemptId]);
    return r;
  });
  if (out.duplicate) return out.payment;
  if (ap.payer_email) await sendReceipt(db, { paymentId: out.payment.id, lang: ap.lang, email: ap.payer_email }).catch(logIgnored('services/bondDesk/autopay'));
  const b = await db.get('SELECT defendant_name FROM bd_bonds WHERE id = ?', [ap.bond_id]);
  if (out.second) {
    logger.warn({ attempt: attemptId, payment: out.payment.id }, '[bd-autopay] a second payment for one installment was posted');
    await alertAgent(db, ap.agent_id, ap.bond_id, 'second', { amount: money(amount), defendant: b?.defendant_name || '' });
  } else if (out.over_balance_cents > 0) {
    await alertAgent(db, ap.agent_id, ap.bond_id, 'over', { amount: money(out.over_balance_cents), defendant: b?.defendant_name || '' });
  }
  return out.payment;
}

/** A charge failed (declined): tell the payer and the agent; schedule the one retry. */
export async function recordAutopayFailure(db, { attemptId, code, message, today }) {
  const att = await db.get('SELECT * FROM bd_autopay_attempts WHERE id = ?', [attemptId]);
  if (!att) return null;
  const retryOn = Number(att.attempt) === 1 ? addDays(today || String(att.due_on).slice(0, 10), RETRY_DAYS) : null;
  const r = await db.get(
    `UPDATE bd_autopay_attempts SET status = 'failed', failure_code = ?, failure_message = ?, retry_on = ?, updated_at = NOW()
      WHERE id = ? AND status = 'processing' RETURNING id`, [code ? String(code).slice(0, 60) : 'failed', message ? String(message).slice(0, 300) : null, retryOn, attemptId]);
  if (!r) return null;   // already recorded (webhook + job)
  await notifyFailure(db, att, retryOn);
  return retryOn;
}

async function notifyFailure(db, att, retryOn) {
  const ap = await db.get('SELECT * FROM bd_autopay WHERE id = ?', [att.autopay_id]);
  const a = await agencyFor(db, ap.agent_id);
  const b = await db.get('SELECT defendant_name FROM bd_bonds WHERE id = ?', [ap.bond_id]);
  const p = { agency: a.agency || a.agent_name, defendant: b?.defendant_name || '', amount: money(att.amount_cents), phone: a.phone || '',
    retry: retryOn ? usDate(retryOn) : '', payer: ap.payer_name };
  const key = retryOn ? 'retry' : 'final';
  if (ap.payer_phone && ap.sms_consent_at) {
    await sendAgentTextRecord(db, { agentId: ap.agent_id, bondId: ap.bond_id, purpose: 'autopay_failed', to: ap.payer_phone,
      body: fitSms((f) => msg(ap.lang, `bd.sms.autopay_failed_${key}`, f), p, [['defendant', 6], ['agency', 12]], { lang: ap.lang }) });
  }
  if (ap.payer_email) {
    await sendAgentEmail({ to: ap.payer_email, subject: msg(ap.lang, 'bd.email.autopay_failed_subject', p), text: withoutOptOut(ap.lang, msg(ap.lang, `bd.sms.autopay_failed_${key}`, p)) });
  }
  const { lang } = await alertAgent(db, ap.agent_id, ap.bond_id, `failed_${key}`, p, a);
  if (a.phone) {
    await sendAgentTextRecord(db, { agentId: ap.agent_id, bondId: ap.bond_id, purpose: 'autopay_failed', to: a.phone,
      body: fitSms((f) => msg(lang, `bd.sms.autopay_agent_failed_${key}`, f), p, [['defendant', 6], ['payer', 6]], { lang }) });
  }
}

/** The bank wants the payer to confirm: cancel the off-session charge, text + e-mail the link. */
async function recordActionNeeded(db, { att, ap, pi, token }) {
  const r = await db.get(`UPDATE bd_autopay_attempts SET status = 'action_needed', failure_code = 'authentication_required', stripe_pi_id = COALESCE(stripe_pi_id, ?), updated_at = NOW()
                           WHERE id = ? AND status = 'processing' RETURNING id`, [pi?.id || null, att.id]);
  if (!r) return;
  if (pi?.id && ['requires_action', 'requires_payment_method', 'requires_confirmation'].includes(pi.status)) {
    await stripeOr503().paymentIntents.cancel(pi.id, {}, { stripeAccount: ap.stripe_account_id }).catch((e) => logger.warn({ err: e?.message }, '[bd-autopay] cancel'));
  }
  const a = await agencyFor(db, ap.agent_id);
  const b = await db.get('SELECT defendant_name FROM bd_bonds WHERE id = ?', [ap.bond_id]);
  // a fresh link (the old one is only stored hashed): the page is the same, the earlier link stops working
  const fresh = token || newToken();
  if (!token) await db.run('UPDATE bd_autopay SET token_hash = ?, updated_at = NOW() WHERE id = ?', [hashToken(fresh), ap.id]);
  const p = { agency: a.agency || a.agent_name, defendant: b?.defendant_name || '', amount: money(att.amount_cents), link: autopayLink(fresh), phone: a.phone || '' };
  if (ap.payer_phone && ap.sms_consent_at) {
    await sendAgentTextRecord(db, { agentId: ap.agent_id, bondId: ap.bond_id, purpose: 'autopay_action', to: ap.payer_phone,
      body: fitSms((f) => msg(ap.lang, 'bd.sms.autopay_action', f), p, [['defendant', 6], ['agency', 12]], { lang: ap.lang }) });
  }
  if (ap.payer_email) await sendAgentEmail({ to: ap.payer_email, subject: msg(ap.lang, 'bd.email.autopay_action_subject', p), text: withoutOptOut(ap.lang, msg(ap.lang, 'bd.sms.autopay_action', p)) });
  await alertAgent(db, ap.agent_id, ap.bond_id, 'action', p, a);
}

/** Create (or re-send, same idempotency key) the off-session charge of one attempt and record the outcome. */
async function chargeAttempt(db, { att, ap, today }) {
  const stripe = stripeOr503();
  const params = {
    amount: Number(att.amount_cents), currency: 'usd', customer: ap.stripe_customer_id, payment_method: ap.stripe_payment_method_id,
    off_session: true, confirm: true, description: `Payment plan installment due ${String(att.due_on).slice(0, 10)}`,
    ...(Number(att.fee_cents) > 0 ? { application_fee_amount: Number(att.fee_cents) } : {}),
    metadata: { bd_kind: 'autopay', bd_attempt_id: String(att.id), bd_autopay_id: String(ap.id), bd_bond_id: String(ap.bond_id), bd_agent_id: String(ap.agent_id) },
  };
  let pi;
  try {
    pi = await stripe.paymentIntents.create(params, { idempotencyKey: att.idempotency_key, stripeAccount: ap.stripe_account_id });
  } catch (e) {
    const failedPi = e?.raw?.payment_intent || e?.payment_intent || null;
    const code = e?.code || e?.raw?.code || failedPi?.last_payment_error?.code || null;
    if (failedPi?.id) await db.run('UPDATE bd_autopay_attempts SET stripe_pi_id = COALESCE(stripe_pi_id, ?), updated_at = NOW() WHERE id = ?', [failedPi.id, att.id]).catch(() => null);
    if (code === 'authentication_required' || failedPi?.status === 'requires_action') {
      await recordActionNeeded(db, { att, ap, pi: failedPi });
      return 'action_needed';
    }
    if (e?.type === 'StripeCardError' || failedPi) {
      await recordAutopayFailure(db, { attemptId: att.id, code: code || e?.decline_code || 'card_declined', message: e?.message, today });
      return 'failed';
    }
    logger.warn({ err: e?.message, attempt: att.id }, '[bd-autopay] Stripe did not answer — re-sent with the same key next run');
    return 'unknown';
  }
  await db.run('UPDATE bd_autopay_attempts SET stripe_pi_id = COALESCE(stripe_pi_id, ?), updated_at = NOW() WHERE id = ?', [pi.id, att.id]);
  if (pi.status === 'succeeded') { await recordAutopaySuccess(db, { attemptId: att.id, pi }); return 'succeeded'; }
  if (pi.status === 'requires_action') { await recordActionNeeded(db, { att, ap, pi }); return 'action_needed'; }
  if (pi.status === 'requires_payment_method' || pi.status === 'canceled') {
    await recordAutopayFailure(db, { attemptId: att.id, code: pi.last_payment_error?.code || 'card_declined', message: pi.last_payment_error?.message, today });
    return 'failed';
  }
  return 'processing';   // the webhook finishes it
}

/** Claim one attempt (unique per installment and attempt number). → attempt row | null */
async function claimAttempt(db, { ap, inst, attempt, amount }) {
  return await db.get(
    `INSERT INTO bd_autopay_attempts (autopay_id, bond_id, installment_id, due_on, attempt, amount_cents, fee_cents, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (installment_id, attempt) DO NOTHING RETURNING *`,
    [ap.id, ap.bond_id, inst.id, inst.due_on, attempt, amount, feeFor(amount), `bd-inst-${inst.id}-${attempt}`]);
}

/**
 * The job. → { checked, charged, succeeded, failed, action_needed }
 * Runs hourly; per agency, nothing is charged before CHARGE_FROM_HOUR local time.
 */
export async function runAutopay(db, { now = new Date() } = {}) {
  const out = { checked: 0, charged: 0, succeeded: 0, failed: 0, action_needed: 0 };
  if (!autopayEnabled() || !stripeConfigured()) return { ...out, skipped: 'off' };
  // 1. attempts Stripe has not answered yet: re-send with the same idempotency key (never a second charge)
  const stuck = await db.all(
    `SELECT t.* FROM bd_autopay_attempts t WHERE t.status = 'processing' AND t.stripe_pi_id IS NULL
        AND t.created_at < (CAST(? AS timestamptz) - INTERVAL '${STUCK_MINUTES} minutes') ORDER BY t.id LIMIT 200`, [now.toISOString()]);
  for (const att of stuck) {
    const ap = await db.get('SELECT * FROM bd_autopay WHERE id = ?', [att.autopay_id]);
    if (ap.status !== 'active' || now - new Date(att.created_at) > 20 * 3600_000) {
      await recordAutopayFailure(db, { attemptId: att.id, code: ap.status !== 'active' ? 'autopay_stopped' : 'no_answer', message: null, today: todayInZone(await agentTz(db, ap.agent_id), now) });
      continue;
    }
    const r = await chargeAttempt(db, { att, ap, today: todayInZone(await agentTz(db, ap.agent_id), now) });
    if (out[r] != null) out[r] += 1;
  }
  // 2. installments due today (and the retries due today) of every active autopay
  const rows = await db.all(
    `SELECT ap.*, u.timezone FROM bd_autopay ap JOIN bd_bonds b ON b.id = ap.bond_id JOIN users u ON u.id = ap.agent_id
      JOIN bd_connect_accounts c ON c.agent_id = ap.agent_id AND c.stripe_account_id = ap.stripe_account_id AND c.charges_enabled
      WHERE ap.status = 'active' AND b.status NOT IN ('exonerated','surrendered','forfeiture_paid','cancelled')
      ORDER BY ap.id LIMIT 5000`);
  for (const ap of rows) {
    const tz = isValidTimeZone(ap.timezone) ? ap.timezone : DEFAULT_TIME_ZONE;
    if (zonedParts(now, tz).hour < CHARGE_FROM_HOUR) continue;
    const today = todayInZone(tz, now);
    out.checked += 1;
    try {
      const l = await bondLedger(db, ap.bond_id, today);
      const agreed = new Set((ap.consent_schedule || []).map((s) => `${s.due_on}|${s.installment_cents}`));
      const due = l.plan.filter((i) => i.due_on === today && i.status !== 'paid' && agreed.has(`${i.due_on}|${i.amount_cents}`)).map((i) => ({ inst: i, attempt: 1 }));
      const retries = await db.all(
        `SELECT t.installment_id FROM bd_autopay_attempts t WHERE t.autopay_id = ? AND t.status = 'failed' AND t.attempt = 1 AND t.retry_on <= ?
            AND NOT EXISTS (SELECT 1 FROM bd_autopay_attempts r WHERE r.installment_id = t.installment_id AND r.attempt = 2)`, [ap.id, today]);
      for (const r of retries) {
        const inst = l.plan.find((i) => Number(i.id) === Number(r.installment_id));
        if (inst && inst.status !== 'paid') due.push({ inst, attempt: 2 });
      }
      let balance = l.balance;
      for (const { inst, attempt } of due) {
        const amount = Math.min(inst.amount_cents - inst.covered_cents, balance);
        if (amount < MIN_CHARGE_CENTS) continue;
        const att = await claimAttempt(db, { ap, inst, attempt, amount });
        if (!att) continue;
        out.charged += 1;
        const r = await chargeAttempt(db, { att, ap, today });
        if (out[r] != null) out[r] += 1;
        if (r === 'succeeded' || r === 'processing') balance -= amount;
      }
    } catch (e) {
      logger.error({ err: e?.message, autopay: ap.id }, '[bd-autopay] bond not processed');
    }
  }
  return out;
}

// ── Webhook (services/stripeWebhook.js) ──────────────────────────────────────

/**
 * payment_intent.succeeded (or a paid Checkout session) with metadata.bd_kind = 'autopay'.
 * Posted only when the payment succeeded on the plan's own connected account (event.account) —
 * review finding 13: metadata alone is not trusted.
 */
export async function onAutopayIntentSucceeded(db, pi, { account } = {}) {
  const attemptId = Number.parseInt(pi?.metadata?.bd_attempt_id, 10);
  if (!Number.isSafeInteger(attemptId) || pi?.status !== 'succeeded') return null;
  const row = await db.get(
    `SELECT ap.id, ap.stripe_account_id FROM bd_autopay_attempts t JOIN bd_autopay ap ON ap.id = t.autopay_id WHERE t.id = ?`, [attemptId]);
  if (!row || !account || account !== row.stripe_account_id) {
    logger.warn({ attempt: attemptId }, '[bd-autopay] payment event not from the plan\'s connected account — ignored');
    return null;
  }
  if (pi.metadata.bd_autopay_id && String(pi.metadata.bd_autopay_id) !== String(row.id)) return null;
  return recordAutopaySuccess(db, { attemptId, pi });
}

/** payment_intent.payment_failed with metadata.bd_kind = 'autopay' (off-session charges only) */
export async function onAutopayIntentFailed(db, pi) {
  const attemptId = Number.parseInt(pi?.metadata?.bd_attempt_id, 10);
  if (!Number.isSafeInteger(attemptId)) return;
  const att = await db.get('SELECT * FROM bd_autopay_attempts WHERE id = ?', [attemptId]);
  if (!att || att.status !== 'processing') return;   // a confirmation in Checkout retries on the page
  const ap = await db.get('SELECT * FROM bd_autopay WHERE id = ?', [att.autopay_id]);
  const code = pi.last_payment_error?.code || null;
  if (code === 'authentication_required') return recordActionNeeded(db, { att, ap, pi });
  await recordAutopayFailure(db, { attemptId, code: code || 'card_declined', message: pi.last_payment_error?.message, today: todayInZone(await agentTz(db, ap.agent_id)) });
}
