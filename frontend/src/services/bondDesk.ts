/**
 * services/bondDesk.ts — types and pure helpers for the Bond Desk screens
 * (bail agents' bonds, paperwork + typed-name e-signature, ledger, powers,
 * reports) and the public signing page. API contract: docs/BOND_DESK.md.
 *
 * Money is integer cents everywhere. Amounts typed by the agent are parsed as
 * strings ("12.50" → 1250) — never through floating point — so the ledger and
 * the payment-plan total check are exact.
 */
import { locale, t, tIn, type TParams } from '../i18n';

export type BondStatus = 'prospect' | 'active' | 'forfeited' | 'exonerated' | 'surrendered' | 'forfeiture_paid' | 'cancelled';
export const BOND_STATUSES: BondStatus[] = ['prospect', 'active', 'forfeited', 'exonerated', 'surrendered', 'forfeiture_paid', 'cancelled'];

/** Allowed status moves (same table as the server: docs/BOND_DESK.md). */
export const TRANSITIONS: Record<BondStatus, BondStatus[]> = {
  prospect: ['active', 'cancelled'],
  active: ['forfeited', 'exonerated', 'surrendered'],
  forfeited: ['active', 'exonerated', 'surrendered', 'forfeiture_paid'],
  exonerated: [], surrendered: [], forfeiture_paid: [], cancelled: [],
};
/** What a move needs besides the status: a date, a forfeiture deadline, an amount. */
export function transitionNeeds(from: BondStatus, to: BondStatus): { date: boolean; deadline: boolean; amount: boolean } {
  return { date: to !== 'cancelled', deadline: to === 'forfeited', amount: to === 'forfeiture_paid' && from === 'forfeited' };
}

export interface Power { id: number; surety_name: string; number: string; limit_cents: number; received_on?: string | null; expires_on?: string | null;
  status?: 'available' | 'executed' | 'void' | 'returned'; bond_id?: number | null; executed_on?: string | null; void_reason?: string | null; defendant_name?: string | null }

export interface Bond {
  id: number; status: BondStatus; defendant_name: string; defendant_dob: string | null; defendant_phone: string | null; defendant_email: string | null;
  defendant_address: string | null; case_number: string | null; court_name: string | null; county: string | null; state: string | null;
  court_date: string | null; charges: string | null; bond_amount_cents: number; surety_name: string | null; posted_on: string | null;
  forfeited_on: string | null; forfeiture_deadline_on: string | null; discharged_on: string | null; forfeiture_paid_cents: number | null;
  checkin_enrollment_id: number | null; notes: string | null; created_at: string; updated_at: string;
  power: { id: number; surety_name: string; number: string; limit_cents: number } | null;
  balance_cents?: number; packet_status?: string | null;
}
export interface Indemnitor { id: number; bond_id: number; full_name: string; relationship: string | null; phone: string | null; email: string | null;
  address: string | null; dob: string | null; employer: string | null; created_at: string }
export interface Charge { id: number; kind: 'premium' | 'fee'; amount_cents: number; description: string | null; created_at: string; voided_at: string | null; void_reason: string | null }
export type PayMethod = 'cash' | 'check' | 'card' | 'money_order' | 'bank_transfer' | 'other';
export const PAY_METHODS: PayMethod[] = ['cash', 'check', 'card', 'money_order', 'bank_transfer', 'other'];
export interface Payment { id: number; receipt_no: string; amount_cents: number; method: PayMethod; reference: string | null; payer_name: string;
  received_on: string; created_at: string; voided_at: string | null; void_reason: string | null }
export interface Installment { id: number; due_on: string; amount_cents: number; covered_cents: number; status: 'paid' | 'partial' | 'due' | 'overdue' }
export type CollateralKind = 'cash' | 'real_estate' | 'vehicle' | 'jewelry' | 'other';
export const COLLATERAL_KINDS: CollateralKind[] = ['cash', 'real_estate', 'vehicle', 'jewelry', 'other'];
export interface Collateral { id: number; receipt_no: string; kind: CollateralKind; description: string; value_cents: number; received_from: string;
  received_on: string; returned_on: string | null; returned_to: string | null; created_at: string }
export interface PacketSummary { id: number; status: PacketStatus; created_at: string; completed_at?: string | null; voided_at?: string | null; signers?: { name: string; status: SignerStatus }[] }
export type PacketStatus = 'sent' | 'in_progress' | 'completed' | 'voided';
export type SignerStatus = 'sent' | 'opened' | 'in_progress' | 'signed' | 'declined';
export interface Money { charged_cents: number; paid_cents: number; balance_cents: number; plan_scheduled_cents: number; plan_in_sync: boolean;
  overdue_cents: number; next_due: Installment | null }
export interface BondDetail { bond: Bond; indemnitors: Indemnitor[]; charges: Charge[]; payments: Payment[]; installments: Installment[];
  collateral: Collateral[]; packets: PacketSummary[]; money: Money }

export type DocRequest = 'id_front' | 'id_back' | 'selfie_with_id' | 'proof_of_income' | 'proof_of_address';
export const DOC_REQUESTS: DocRequest[] = ['id_front', 'id_back', 'selfie_with_id', 'proof_of_income', 'proof_of_address'];
export interface PacketSigner { id: number; role: 'defendant' | 'indemnitor'; name: string; phone: string | null; email: string | null; status: SignerStatus;
  sent_at: string | null; opened_at: string | null; signed_at: string | null; declined_reason: string | null; answers: Record<string, string> | null;
  events: { event: string; detail?: string | null; at: string; ip: string | null }[] }
export interface PacketDetail {
  packet: { id: number; bond_id: number; status: PacketStatus; questions: string; custom_questions: string[]; doc_requests: DocRequest[];
    created_at: string; completed_at: string | null; voided_at: string | null };
  signers: PacketSigner[];
  documents: { id: number; signer_id: number; form_id: number; name: string; status: 'pending' | 'prepared' | 'signed'; prepared_sha256: string | null; signed_sha256: string | null }[];
  uploads: { id: number; signer_id: number; kind: string; content_type: string; size: number; created_at: string }[];
}
export type Delivery = 'sms' | 'email' | 'both' | 'none';
export type DeliveryResult = 'sent' | 'skipped' | 'failed' | 'opted_out' | null;
export interface CreatedSigner { id: number; name: string; role: string; link: string; delivery?: { sms: DeliveryResult; email: DeliveryResult } }

export interface FormField { name: string; type: 'text' | 'checkbox' | 'other' }
export interface BondForm { id: number; name: string; page_count: number; roles: ('defendant' | 'indemnitor')[]; fields: FormField[];
  field_map: Record<string, string>; archived: boolean; created_at: string }

export interface Access { allowed: boolean; reason: null | 'not_agent' | 'no_plan'; plan: string | null; texts_live: boolean; email_live: boolean; storage_live: boolean; text_cents: number;
  /** ⚖ features behind a server setting (absent on older servers = off) */
  features?: { rearrest_alerts: boolean; recovery_sharing: boolean } }
export interface Dashboard {
  counts: { prospect: number; active: number; forfeited: number }; liability_cents: number; receivable_cents: number; overdue_cents: number;
  overdue: { bond_id: number; defendant_name: string; due_on: string; amount_due_cents: number }[];
  forfeitures: { bond_id: number; defendant_name: string; deadline_on: string; days_left: number }[];
  awaiting_signature: { packet_id: number; bond_id: number; defendant_name: string; pending: number }[];
  texts_this_month: { count: number; cents: number };
  /** missed check-ins (last 7 days) of bonds linked to a check-in enrollment; absent on older servers */
  missed_checkins?: { bond_id: number; enrollment_id: number; defendant_name: string; day: string }[];
  /** re-arrest matches of the last 30 days (empty while the setting is off) */
  rearrests?: (Rearrest & { defendant_name: string })[];
}

// ── Re-arrest alerts, timeline, recovery-agent sharing (routes/bondDesk/watch.js) ──
export interface Rearrest { id: number; bond_id: number; arrest_id: number; match: 'strong' | 'possible'; status: 'alerted' | 'pending' | 'confirmed' | 'dismissed';
  created_at: string; decided_at: string | null;
  booking: { name: string; booking_date: string | null; county: string | null; state: string | null; facility: string | null; charges: string | null; dob_on_roster: boolean };
  alerts: { push: string | null; email: string | null; text: string | null } }
export interface RearrestView { coverage: { feeds_configured: boolean; counties: { county: string; state: string | null }[] }; watching: boolean;
  dob_on_file: boolean; matches: Rearrest[]; settings: { rearrest_text: boolean; alert_phone: string | null }; text_cents: number }
export interface BondEvent { id: number; kind: string; detail: Record<string, unknown>; at: string }
export interface StateRule { state: string; allowed: boolean | null; license: boolean | null; agency: string | null; law: string | null; notes: string | null;
  source_url: string | null; checked: 'secondary' | 'unverified' | string }
export interface RecoveryShare { id: number; invite_email: string; share_locations: boolean; created_at: string; accepted_at: string | null; account_name: string | null;
  status: 'invited' | 'active' | 'invite_expired' | 'ended'; ended_at: string | null; ended_reason: string | null; views: { what: 'details' | 'photo'; at: string }[] }
export interface RecoveryView { bond_status: BondStatus; state: string | null; state_rule: StateRule | null; shares: RecoveryShare[] }

/** "Davidson, TN · Shelby, TN" for the coverage line. */
export const coverageText = (c: RearrestView['coverage']) => c.counties.map(x => (x.state ? `${x.county}, ${x.state}` : x.county)).join(' · ');

// ── Court dates and the texts about them (routes/bondDesk/courtDates.js) ─────
export type CourtStatus = 'scheduled' | 'attended' | 'missed' | 'rescheduled' | 'cancelled';
export const COURT_STATUSES: CourtStatus[] = ['scheduled', 'attended', 'missed', 'rescheduled', 'cancelled'];
export interface BdCourtDate { id: number; court_date: string; court_time: string | null; court_name: string | null; room: string | null;
  status: CourtStatus; status_source: 'agent' | 'reply' | null; status_at: string | null; asked_at: string | null; is_past: boolean }
export interface TextRecipient { to: 'defendant' | 'indemnitor'; indemnitor_id: number | null; name: string; phone: string | null;
  phone_masked: string | null; consent: boolean; consent_at: string | null; opted_out: boolean }
export interface CourtListing { court_dates: BdCourtDate[]; reminders_on: boolean; text_lang: 'en' | 'es' | 'pt' | 'vi'; time_zone: string;
  today: string; texts_live: boolean; bond_status: BondStatus; recipients: TextRecipient[] }
export type ReminderStep = 'd7' | 'd3' | 'd1' | 'd0' | 'now' | 'ask' | 'missed';
export interface BdReminder { id: number; court_date_id: number; court_day: string; step: ReminderStep; signer_type: 'defendant' | 'indemnitor';
  name: string | null; to_masked: string; send_at: string; status: 'pending' | 'sending' | 'sent' | 'skipped' | 'cancelled' | 'failed';
  reason: string | null; sent_at: string | null; delivery_status: string | null; error_code: string | null }

/** A hearing draft → the request body, or the i18n key of the first problem. */
export function courtDateBody(d: { date: string; time: string; court: string; room: string }): { body?: Record<string, string | null>; error?: string } {
  const date = d.date.trim(); const time = d.time.trim();
  if (!isIsoDate(date)) return { error: 'bdk_cd_err_date' };
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: 'bdk_cd_err_time' };
  return { body: { court_date: date, court_time: time || null, court_name: d.court.trim() || null, room: d.room.trim() || null } };
}

/** Tone for a text's status on the timeline (delivery status wins once the carrier reports). */
export function reminderTone(r: Pick<BdReminder, 'status' | 'delivery_status'>): 'ok' | 'warn' | 'danger' | 'muted' {
  if (r.delivery_status === 'delivered') return 'ok';
  if (r.delivery_status && r.delivery_status !== 'delivered') return 'danger';
  if (r.status === 'failed') return 'danger';
  if (r.status === 'skipped') return 'warn';
  if (r.status === 'sent') return 'ok';
  return 'muted';
}

/** Same order as the server's data_keys (docs/BOND_DESK.md). */
export const DATA_KEYS = [
  'bond.defendant_name', 'bond.defendant_dob', 'bond.defendant_address', 'bond.defendant_phone', 'bond.defendant_email',
  'bond.case_number', 'bond.court_name', 'bond.county', 'bond.state', 'bond.court_date', 'bond.charges', 'bond.bond_amount',
  'bond.premium', 'bond.power_number', 'bond.surety_name', 'agent.name', 'agent.agency', 'agent.license', 'agent.phone',
  'agent.email', 'signer.full_name', 'signer.role', 'signer.relationship', 'signer.phone', 'signer.email', 'signer.address',
  'signer.dob', 'signer.employer', 'signer.employer_phone', 'signer.job_title', 'signer.monthly_income',
  'signer.years_at_address', 'signer.drivers_license', 'signer.vehicle', 'signer.reference_1', 'signer.reference_2',
  'date.today', 'signature.name', 'signature.date',
] as const;
/** i18n key for a data key's label: 'bond.case_number' → 'bdk_dk_bond_case_number'. */
export const dataKeyLabelKey = (k: string) => `bdk_dk_${k.replace(/\./g, '_')}`;

// ── Money ────────────────────────────────────────────────────────────────────
/** "$1,234.50" for cents, in the app language's number format. */
export const money = (cents: number | null | undefined) =>
  ((Number(cents) || 0) / 100).toLocaleString(locale(), { style: 'currency', currency: 'USD' });

/**
 * Dollars typed by a person → cents, exactly (no floating point). Accepts
 * "1250", "1,250", "1250.5", "$1,250.50". Returns null for anything else,
 * for more than two decimals and for amounts over $9,999,999.99.
 */
export function parseCents(input: string): number | null {
  const s = String(input ?? '').trim().replace(/^\$/, '').replace(/,/g, '');
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + (m[2] ? Number(m[2].padEnd(2, '0')) : 0);
}
/** Cents → "1250.50" for an edit field. */
export const centsToInput = (cents: number | null | undefined) => (cents == null ? '' : `${Math.trunc(cents / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`);

// ── Dates ────────────────────────────────────────────────────────────────────
/** A real calendar day written YYYY-MM-DD. */
export function isIsoDate(s: string | null | undefined): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
/** Today on this device, YYYY-MM-DD. */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
/** "March 4, 2026" for a YYYY-MM-DD day (no time-zone shift). */
export function fmtDay(day: string | null | undefined): string {
  if (!day) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return String(day);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
/** Date and time for an ISO timestamp, in the device's zone. */
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString(locale(), { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ── Payment plan ─────────────────────────────────────────────────────────────
export interface PlanRow { due_on: string; amount: string }
/**
 * Checks a payment-plan draft against the bond's total charges.
 * → { ok, installments (cents), total_cents, error: null | 'bad_row' | 'total' | 'order' }
 */
export function checkPlan(rows: PlanRow[], chargedCents: number) {
  const installments: { due_on: string; amount_cents: number }[] = [];
  for (const r of rows) {
    const c = parseCents(r.amount);
    if (!isIsoDate(r.due_on) || c === null || c <= 0) return { ok: false, installments, total_cents: 0, error: 'bad_row' as const };
    installments.push({ due_on: r.due_on, amount_cents: c });
  }
  const total = installments.reduce((n, i) => n + i.amount_cents, 0);
  if (installments.length && total !== chargedCents) return { ok: false, installments, total_cents: total, error: 'total' as const };
  const days = installments.map(i => i.due_on);
  if (new Set(days).size !== days.length) return { ok: false, installments, total_cents: total, error: 'order' as const };
  return { ok: true, installments: [...installments].sort((a, b) => a.due_on.localeCompare(b.due_on)), total_cents: total, error: null };
}

/**
 * Splits `totalCents` into `n` installments every `everyDays` from `first`
 * (the remainder cents go on the first one, so the sum is exact).
 */
export function splitPlan(totalCents: number, n: number, first: string, everyDays: number): PlanRow[] {
  if (!(n >= 1) || !isIsoDate(first) || totalCents <= 0) return [];
  const base = Math.floor(totalCents / n);
  const rest = totalCents - base * n;
  const [y, mo, d] = first.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const day = new Date(Date.UTC(y, mo - 1, d + i * everyDays));
    const iso = day.toISOString().slice(0, 10);
    return { due_on: iso, amount: centsToInput(base + (i === 0 ? rest : 0)) };
  });
}

// ── Signing ──────────────────────────────────────────────────────────────────
/** The typed signature must be the signer's name (case and spacing ignored) — same rule as the server. */
export const normName = (s: string) => String(s || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export const nameMatches = (typed: string, name: string) => !!normName(typed) && normName(typed) === normName(name);

/** The masked part of a link for display ("…/sign/ab12…"). */
export const maskLink = (link: string) => (link.length > 40 ? `${link.slice(0, 36)}…` : link);

/** t(key) when the key exists, else the fallback text (server values we may not have a label for). */
export function tOr(key: string, fallback: string, params?: TParams): string {
  return tIn('en', key) ? t(key, params) : fallback;
}
