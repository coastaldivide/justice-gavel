/**
 * services/bondDesk/money.js — the bond ledger, as pure functions over whole cents.
 *
 * Only additions and subtractions of integer cents the agent entered: no rates, no
 * percentages, no rounding anywhere. Voided rows never count. A payment plan is a list of
 * installments; the total paid (non-void) covers them in due-date order (oldest first).
 */

const live = (r) => !r.voided_at;
const cents = (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`not whole cents: ${v}`);
  return n;
};

/** Sum of non-void amounts. */
export function liveTotal(rows) {
  return rows.filter(live).reduce((s, r) => s + cents(r.amount_cents), 0);
}

/**
 * Installment statuses for `todayStr` ('YYYY-MM-DD'):
 *   paid     fully covered
 *   partial  partly covered and not yet past due
 *   due      nothing covered, not yet past due (due today counts as due, not overdue)
 *   overdue  past its due date and not fully covered
 */
export function planStatus(installments, paidCents, todayStr) {
  let left = Math.max(0, cents(paidCents));
  return [...installments]
    .sort((a, b) => (a.due_on < b.due_on ? -1 : a.due_on > b.due_on ? 1 : Number(a.id || 0) - Number(b.id || 0)))
    .map((i) => {
      const amount = cents(i.amount_cents);
      const covered = Math.min(amount, left);
      left -= covered;
      let status;
      if (covered === amount) status = 'paid';
      else if (i.due_on < todayStr) status = 'overdue';
      else status = covered > 0 ? 'partial' : 'due';
      return { id: i.id == null ? null : Number(i.id), due_on: i.due_on, amount_cents: amount, covered_cents: covered, status };
    });
}

/** The money block of a bond: { charged, paid, balance, plan totals, overdue, next due }. */
export function bondMoney({ charges, payments, installments, planChargedCents }, todayStr) {
  const charged = liveTotal(charges);
  const paid = liveTotal(payments);
  const plan = planStatus(installments, paid, todayStr);
  const scheduled = plan.reduce((s, i) => s + i.amount_cents, 0);
  const overdue = plan.filter((i) => i.status === 'overdue').reduce((s, i) => s + (i.amount_cents - i.covered_cents), 0);
  const next = plan.find((i) => i.status !== 'paid') || null;
  return {
    charged_cents: charged,
    paid_cents: paid,
    balance_cents: charged - paid,
    plan_scheduled_cents: scheduled,
    // the plan was saved against a total that has since changed (a charge added or voided)
    plan_in_sync: plan.length === 0 || (scheduled === charged && Number(planChargedCents) === charged),
    overdue_cents: overdue,
    next_due: next,
    installments: plan,
  };
}

/** Validate a new plan: dates, positive whole cents, and the exact total. → error code or null. */
export function planError(installments, chargedCents) {
  if (!Array.isArray(installments)) return 'bad_plan';
  if (installments.length > 120) return 'bad_plan';
  const seen = new Set();
  let total = 0;
  for (const i of installments) {
    if (!i || !isDate(i.due_on)) return 'bad_plan';
    const a = Number(i.amount_cents);
    if (!Number.isSafeInteger(a) || a <= 0) return 'bad_plan';
    if (seen.has(i.due_on)) return 'bad_plan';   // one installment per day keeps the order unambiguous
    seen.add(i.due_on);
    total += a;
  }
  if (installments.length && total !== cents(chargedCents)) return 'plan_total';
  return null;
}

/** A real calendar date 'YYYY-MM-DD' (no 2026-02-30). */
export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1900 && y <= 2200;
}

/** "$1,234.56" for cents (always two decimals — receipts and forms). */
export function money(c) {
  const n = cents(c);
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  return `${sign}$${Math.floor(a / 100).toLocaleString('en-US')}.${String(a % 100).padStart(2, '0')}`;
}

/** 'MM/DD/YYYY' for a 'YYYY-MM-DD' date (US forms), '' for none. */
export function usDate(s) {
  if (!isDate(s)) return '';
  const [y, m, d] = s.split('-');
  return `${m}/${d}/${y}`;
}
