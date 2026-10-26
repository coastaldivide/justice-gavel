/**
 * services/bondDesk/core.js — shared Bond Desk logic (docs/BOND_DESK.md): who may use it,
 * the agency's details, the questions, the values that fill a form, signing links and the
 * texts sent for an agent (5¢ each, plans.js AGENT_TEXT_CENTS).
 */
import crypto from 'node:crypto';
import { PAID_STATUSES } from '../entitlements.js';
import { AGENT_TEXT_CENTS } from '../../routes/billing/plans.js';
import { sendSms, smsLive, toE164 } from '../sms.js';
import { emailLive, sendEmail } from '../email.js';
import { DEFAULT_TIME_ZONE, isValidTimeZone, todayInZone } from '../../utils/timezone.js';
import { money, usDate } from './money.js';
import { msg } from '../../i18n/index.js';
import logger from '../../utils/logger.js';

const PAID_SQL = PAID_STATUSES.map((s) => `'${s}'`).join(',');
const isAdmin = (u) => ['admin', 'super_admin'].includes(u?.role);

// ── Access ────────────────────────────────────────────────────────────────────

/** → { allowed, reason: null|'not_agent'|'no_plan', plan, profile } */
export async function agentAccess(db, user) {
  const profile = await db.get(
    'SELECT user_id, company_name, license_number, phone, email, name FROM bondsman_profiles WHERE user_id = ?', [user.id]);
  const sub = await db.get(
    `SELECT tier, stripe_sub_id FROM bondsman_subscriptions WHERE user_id = ? AND status IN (${PAID_SQL}) ORDER BY id DESC LIMIT 1`,
    [user.id]).catch(() => null);
  if (isAdmin(user)) return { allowed: true, reason: null, plan: sub?.tier || null, profile };
  if (!profile) return { allowed: false, reason: 'not_agent', plan: null, profile: null };
  if (!sub) return { allowed: false, reason: 'no_plan', plan: null, profile };
  return { allowed: true, reason: null, plan: sub.tier, profile };
}

/** The agency as printed on receipts, forms and signing pages. */
export async function agencyFor(db, agentId) {
  const p = await db.get('SELECT company_name, license_number, phone, email, name FROM bondsman_profiles WHERE user_id = ?', [agentId]);
  const u = await db.get('SELECT name, display_name, email, phone, timezone FROM users WHERE id = ?', [agentId]);
  return {
    agency: p?.company_name || u?.display_name || u?.name || '',
    agent_name: p?.name || u?.display_name || u?.name || '',
    license: p?.license_number || '',
    phone: p?.phone || u?.phone || '',
    email: p?.email || u?.email || '',
    tz: isValidTimeZone(u?.timezone) ? u.timezone : DEFAULT_TIME_ZONE,
  };
}

/** 'YYYY-MM-DD' today in the agent's zone. */
export async function agentToday(db, agentId) {
  const u = await db.get('SELECT timezone FROM users WHERE id = ?', [agentId]);
  return todayInZone(isValidTimeZone(u?.timezone) ? u.timezone : DEFAULT_TIME_ZONE);
}

// ── Questions ─────────────────────────────────────────────────────────────────

const Q = (key, required) => ({ key, required });
const BASIC = [Q('dob', true), Q('phone', true), Q('email', false), Q('address', true), Q('years_at_address', false),
  Q('employer', false), Q('employer_phone', false), Q('job_title', false)];
const FULL_EXTRA = [Q('monthly_income', false), Q('drivers_license', true), Q('vehicle', false), Q('reference_1', true), Q('reference_2', false)];
export const QUESTION_KEYS = [...BASIC, ...FULL_EXTRA, Q('relationship', true)].map((q) => q.key);

/** The questions a signer answers: [{ key, label_key, label, required }]. */
export function questionsFor(packet, role) {
  const set = packet.questions === 'full' ? [...BASIC, ...FULL_EXTRA] : packet.questions === 'basic' ? BASIC : [];
  const out = set.map((q) => ({ key: q.key, label_key: `sgn_q_${q.key}`, label: null, required: q.required }));
  if (set.length && role === 'indemnitor') out.unshift({ key: 'relationship', label_key: 'sgn_q_relationship', label: null, required: true });
  const custom = Array.isArray(packet.custom_questions) ? packet.custom_questions : [];
  custom.forEach((label, i) => out.push({ key: `custom_${i + 1}`, label_key: null, label: String(label), required: true }));
  return out;
}

// ── Form values ───────────────────────────────────────────────────────────────

export const DATA_KEYS = Object.freeze([
  'bond.defendant_name', 'bond.defendant_dob', 'bond.defendant_address', 'bond.defendant_phone', 'bond.defendant_email',
  'bond.case_number', 'bond.court_name', 'bond.county', 'bond.state', 'bond.court_date', 'bond.charges', 'bond.bond_amount',
  'bond.premium', 'bond.power_number', 'bond.surety_name', 'agent.name', 'agent.agency', 'agent.license', 'agent.phone',
  'agent.email', 'signer.full_name', 'signer.role', 'signer.relationship', 'signer.phone', 'signer.email', 'signer.address',
  'signer.dob', 'signer.employer', 'signer.employer_phone', 'signer.job_title', 'signer.monthly_income',
  'signer.years_at_address', 'signer.drivers_license', 'signer.vehicle', 'signer.reference_1', 'signer.reference_2',
  'date.today', 'signature.name', 'signature.date',
]);
export const SIGNATURE_KEYS = Object.freeze(['signature.name', 'signature.date']);

/**
 * Every data key's text for one signer's copy (signature keys excluded).
 * ctx: { bond, agency, signer, indemnitor, premiumCents, powerNumber, today }
 */
export function dataValues({ bond, agency, signer, indemnitor, premiumCents, powerNumber, today }) {
  const a = signer.answers || {};
  const isDef = signer.role === 'defendant';
  const pick = (answer, ...fallbacks) => {
    const v = [answer, ...fallbacks].find((x) => x != null && String(x).trim() !== '');
    return v == null ? '' : String(v).trim();
  };
  const dobRaw = pick(a.dob, isDef ? bond.defendant_dob : indemnitor?.dob);
  return {
    'bond.defendant_name': bond.defendant_name || '',
    'bond.defendant_dob': usDate(bond.defendant_dob),
    'bond.defendant_address': bond.defendant_address || '',
    'bond.defendant_phone': bond.defendant_phone || '',
    'bond.defendant_email': bond.defendant_email || '',
    'bond.case_number': bond.case_number || '',
    'bond.court_name': bond.court_name || '',
    'bond.county': bond.county || '',
    'bond.state': bond.state || '',
    'bond.court_date': usDate(bond.court_date),
    'bond.charges': bond.charges || '',
    'bond.bond_amount': money(bond.bond_amount_cents),
    'bond.premium': premiumCents > 0 ? money(premiumCents) : '',
    'bond.power_number': powerNumber || '',
    'bond.surety_name': bond.surety_name || '',
    'agent.name': agency.agent_name,
    'agent.agency': agency.agency,
    'agent.license': agency.license,
    'agent.phone': agency.phone,
    'agent.email': agency.email,
    'signer.full_name': signer.name,
    'signer.role': isDef ? 'Defendant' : 'Indemnitor',
    'signer.relationship': isDef ? 'Self' : pick(a.relationship, indemnitor?.relationship),
    'signer.phone': pick(a.phone, signer.phone),
    'signer.email': pick(a.email, signer.email),
    'signer.address': pick(a.address, isDef ? bond.defendant_address : indemnitor?.address),
    'signer.dob': /^\d{4}-\d{2}-\d{2}$/.test(dobRaw) ? usDate(dobRaw) : dobRaw,
    'signer.employer': pick(a.employer, isDef ? null : indemnitor?.employer),
    'signer.employer_phone': pick(a.employer_phone),
    'signer.job_title': pick(a.job_title),
    'signer.monthly_income': pick(a.monthly_income),
    'signer.years_at_address': pick(a.years_at_address),
    'signer.drivers_license': pick(a.drivers_license),
    'signer.vehicle': pick(a.vehicle),
    'signer.reference_1': pick(a.reference_1),
    'signer.reference_2': pick(a.reference_2),
    'date.today': usDate(today),
  };
}

/** { fieldName: text } for a form's map (signature keys left out). */
export function fieldValues(fieldMap, values) {
  const out = {};
  for (const [field, key] of Object.entries(fieldMap || {})) {
    if (SIGNATURE_KEYS.includes(key)) continue;
    if (Object.prototype.hasOwnProperty.call(values, key)) out[field] = values[key];
  }
  return out;
}

/** { fieldName: text } for the signature keys of a form's map. */
export function signatureValues(fieldMap, { typedName, signedDate }) {
  const out = {};
  for (const [field, key] of Object.entries(fieldMap || {})) {
    if (key === 'signature.name') out[field] = `/s/ ${typedName}`;
    if (key === 'signature.date') out[field] = usDate(signedDate);
  }
  return out;
}

// ── Signing links ─────────────────────────────────────────────────────────────

export const LINK_DAYS = 30;            // a link works this long after it is sent
export const DOWNLOAD_DAYS = 60;        // and this long after signing (to download the copy)
export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const signLink = (token) => `${String(process.env.APP_URL || 'https://justicegavel.app').replace(/\/+$/, '')}/sign/${token}`;

/** Same name? (case, accents kept; spaces and case ignored) */
export const sameName = (a, b) => {
  const n = (s) => String(s || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
  return n(a) !== '' && n(a) === n(b);
};

export const CONSENT_VERSION = 'esign-2026-10';
/**
 * The consent wording, word for word the English text the signing page shows (frontend i18n keys
 * sgn_esign_consent, sgn_agree_esign, sgn_agree_terms — bond_desk_consent.test.js keeps them equal).
 * Printed on the certificate; the page shows the same text in the signer's language.
 */
export const CONSENT_LINES = Object.freeze([
  "Signing electronically: you may ask the agency for paper copies of these documents at no charge, and you may sign on paper instead — to do that, do not sign here and contact the agency (phone above). You can stop at any time before you sign. You need a device that can open PDF files; you will get a copy of everything you sign right after signing. Your typed name is your legal signature (federal ESIGN Act and your state's Uniform Electronic Transactions Act).",
  "I agree to sign these documents electronically and to receive them electronically.",
  "I have read the documents and agree to them.",
]);

// ── Texts for agents (5¢ each) ───────────────────────────────────────────────

export const maskPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 4 ? `•••-•••-${d.slice(-4)}` : '•••'; };
export const maskEmail = (e) => { const [u, h] = String(e || '').split('@'); return h ? `${u.slice(0, 1)}•••@${h}` : '•••'; };

/**
 * Text someone for an agent. Never to a number that replied STOP. Logged and billed only when
 * the carrier accepted it. → 'sent' | 'skipped' | 'failed' | 'opted_out'
 */
export async function sendAgentText(db, { agentId, bondId, purpose, to, body }) {
  const dest = toE164(to);
  if (!dest) return 'skipped';
  const out = await db.get('SELECT phone FROM sms_opt_outs WHERE phone = ?', [dest]);
  if (out) return 'opted_out';
  if (!smsLive()) return 'skipped';
  const r = await sendSms({ to: dest, body });
  if (!r?.ok) {
    logger.warn({ err: r?.error }, '[bond-desk] text not sent');
    return r?.skipped ? 'skipped' : 'failed';
  }
  await db.run('INSERT INTO bd_texts (agent_id, bond_id, purpose, to_masked, provider_id, cents) VALUES (?, ?, ?, ?, ?, ?)',
    [agentId, bondId || null, purpose, maskPhone(dest), r.id || null, AGENT_TEXT_CENTS]);
  return 'sent';
}

/** E-mail for an agent (free). → 'sent' | 'skipped' | 'failed' */
export async function sendAgentEmail({ to, subject, text }) {
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to))) return 'skipped';
  if (!emailLive()) return 'skipped';
  try {
    const r = await sendEmail({ to, subject, text });
    return r === false || r?.ok === false || r?.error ? 'failed' : 'sent';
  } catch (e) {
    logger.warn({ err: e?.message }, '[bond-desk] e-mail not sent');
    return 'failed';
  }
}

/** The signing-link message in the packet's language. */
export function signingMessage(lang, { agency, defendant, link }) {
  return {
    sms: msg(lang, 'bd.sms.sign', { agency, defendant, link }),
    subject: msg(lang, 'bd.email.sign_subject', { agency }),
    email: msg(lang, 'bd.email.sign_body', { agency, defendant, link }),
  };
}

/** The payment-reminder message. */
export function reminderMessage(lang, { agency, defendant, amount, date, balance, phone }) {
  const key = date ? 'bd.sms.remind_due' : 'bd.sms.remind_balance';
  return {
    sms: msg(lang, key, { agency, defendant, amount, date, balance, phone }),
    subject: msg(lang, 'bd.email.remind_subject', { agency }),
    email: msg(lang, key, { agency, defendant, amount, date, balance, phone }),
  };
}
