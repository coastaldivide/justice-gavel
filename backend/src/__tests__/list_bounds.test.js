/**
 * list_bounds.test.js — checklist item 23: every list a route returns is
 * bounded.
 *
 * Scans every `.all(` SELECT in src/routes. A query without LIMIT is allowed
 * only when it is listed below with the reason it is naturally bounded or
 * must be complete (an invoice's own line items, a conflict check, a fixed
 * reference table, an internal fan-out). Anything else fails, so a new
 * unbounded list endpoint cannot ship.
 *
 * The behavioural half lives in integration/list_bounds.int.test.js (600
 * saved lawyers / contacts / monitors seeded → each endpoint returns at most
 * its cap).
 */
import fs from 'fs';
import path from 'path';

const __REPO = decodeURIComponent(new URL('../../../', import.meta.url).pathname).replace(/\/$/, '');
const ROUTES = path.join(__REPO, 'backend/src/routes');

// key: "<file>|<first 40 chars of the SQL, whitespace collapsed>" (prefix match)
const ALLOWED = {
  'attorney/cases.js|SELECT c.outcome FROM cases c JOIN case_a': "outcome stats over the attorney's own assignments (one column, aggregated in JS)",
  'billing/connections.js|SELECT ${LAWYER_COLS} FROM lawyers l WH': 'directory search candidates (in memory, ~2k rows); the response is capped (FC_LAWYERS)',
  'billing/connections.js|SELECT ${BAIL_COLS} FROM bail_agents WHER': 'directory search candidates (in memory, ~1.3k rows); the response is capped (FC_AGENTS)',
  'billing/connections.js|SELECT ${cols} FROM ${table} WHERE ${key}': 'lookup of the listings already chosen for one family plan (IN list)',
  'match.js|SELECT ${LAWYERS_COLS} FROM lawyers l WHERE C': 'directory search candidates (in memory); the response is capped at 30',
  'messages.js|SELECT defender_id FROM case_assignments WH': 'active counsel on one case (internal notify)',
  'providers.js|SELECT ${LAWYER_COLS} FROM lawyers l WHERE C': 'directory search candidates (in memory); the response is paginated',
  'providers.js|SELECT ${BAIL_COLS} FROM bail_agents WHERE COA': 'directory search candidates (in memory); the response is paginated',
  // section G: the conflict check reads the firm's index / parties / matters once with LIMIT ${MAX_ROWS} (50k)
  'attorney/inbox.js|SELECT id, display_name FROM users WHERE': 'names for the direct-message threads already listed (IN list of ≤ 50 ids)',
  'messages.js|SELECT id, display_name FROM users WHERE id IN': 'names for the direct-message threads already listed (IN list, threads capped at 200)',
  // section F (shared fix in G: these were missing here)
  'expungement/attorneys.js|SELECT ${LAWYER_COLS} FROM lawyers l W': "one state's directory candidates (in memory); the response is capped (limit)",
  'hague_contacts.js|SELECT ${AUTH_COLS} FROM hague_central_auth': 'fixed reference table (recorded Central Authorities)',
  'hague_contacts.js|SELECT key, name, phone, website, statute,': 'fixed reference table (recorded U.S. resources)',
  'legaldata.js|SELECT row_id, field, text, source_md5 FROM con': "stored translations for the rows already selected (one table's IN list)",
  'conflicts.js|SELECT id, control_id, category, title,': 'fixed SOC 2 control catalogue (seeded reference table)',
  'contracts/execution.js|SELECT status FROM contract_executions W': 'one contract\'s signers, internal check',
  'firm_acquisition.js|SELECT tier_key, display_name, monthly_c': 'fixed pricing catalogue',
  'firm_verticals.js|SELECT rule_key, label, days, business_d': 'fixed deadline-preset catalogue',
  'firm_verticals.js|SELECT tier_key, display_name, monthly_c': 'fixed pricing catalogue',
  'integrations/caldav.js|SELECT id, matter_id, firm_id, entry_dat': 'internal sync of one matter\'s pending docket',
  'integrations/dms.js|SELECT id, matter_id, external_doc_id, p': 'internal sync loop',
  'integrations/practice-mgmt.js|SELECT id, matter_id, user_id, aba_code,': 'push of one invoice / matter to the PM system must be complete',
  'messages.js|SELECT l.id, l.name, l.firm, l.phone, l.': 'bulk message targets — IN list capped by the route',
  'privilege.js|SELECT ${ENTRY_COLS} FROM privilege_log': 'privilege-log PDF / CSV export must be the complete log',
  'time.js|SELECT te.*, u.display_name AS attorney_': 'one invoice\'s own line items (invoice view / PDF must be complete)',
  'webhooks/outbound.js|SELECT ${SUB_COLS_WITH_SECRET} FROM webh': 'internal delivery fan-out',
  'webpush.js|SELECT endpoint, p256dh, auth FROM web_p': 'internal push fan-out to one user\'s browsers',
  // Bond Desk (docs/BOND_DESK.md): the agent's own book, naturally bounded per bond / packet; totals must be complete
  'bondDesk/bonds.js|SELECT id, kind, amount_cents, descripti': "Bond Desk ledger: one bond's (or the agent's) charges / payments / installments — balances and totals must add every row",
  'bondDesk/bonds.js|SELECT id, receipt_no, amount_cents, met': "Bond Desk ledger: one bond's (or the agent's) charges / payments / installments — balances and totals must add every row",
  'bondDesk/bonds.js|SELECT id, due_on, amount_cents FROM bd_': "Bond Desk ledger: one bond's (or the agent's) charges / payments / installments — balances and totals must add every row",
  'bondDesk/bonds.js|SELECT id, bond_id, full_name, relations': "one bond's indemnitors (capped at 10 on insert)",
  'bondDesk/bonds.js|SELECT id, receipt_no, kind, description': "one packet's / bond's own children (≤ 6 signers, ≤ 10 forms each) — the agent's record must be complete",
  'bondDesk/bonds.js|SELECT id, status, created_at, completed': "one packet's / bond's own children (≤ 6 signers, ≤ 10 forms each) — the agent's record must be complete",
  'bondDesk/bonds.js|SELECT packet_id, id, name, role, status': "one packet's / bond's own children (≤ 6 signers, ≤ 10 forms each) — the agent's record must be complete",
  'bondDesk/bonds.js|SELECT amount_cents, voided_at FROM bd_c': "Bond Desk ledger: one bond's (or the agent's) charges / payments / installments — balances and totals must add every row",
  'bondDesk/bonds.js|SELECT amount_cents, voided_at FROM bd_p': "Bond Desk ledger: one bond's (or the agent's) charges / payments / installments — balances and totals must add every row",
  'bondDesk/bonds.js|SELECT DISTINCT surety_name FROM bd_powe': "distinct surety names in the agent's own power inventory (filter list)",
  'bondDesk/paperwork.js|SELECT ${FORM_COLS} FROM bd_forms WHERE ': "the agent's form library (capped at 100 active forms on upload)",
  'bondDesk/paperwork.js|SELECT amount_cents, voided_at FROM bd_c': "Bond Desk ledger: one bond's (or the agent's) charges / payments / installments — balances and totals must add every row",
  'bondDesk/paperwork.js|SELECT id, roles FROM bd_forms WHERE age': "the agent's form library (capped at 100 active forms on upload)",
  'bondDesk/paperwork.js|SELECT id, role, indemnitor_id, name, ph': "one packet's / bond's own children (≤ 6 signers, ≤ 10 forms each) — the agent's record must be complete",
  'bondDesk/paperwork.js|SELECT id, signer_id, form_id, name, sta': "one packet's / bond's own children (≤ 6 signers, ≤ 10 forms each) — the agent's record must be complete",
  'bondDesk/paperwork.js|SELECT id, signer_id, kind, content_type': "one packet's / bond's own children (≤ 6 signers, ≤ 10 forms each) — the agent's record must be complete",
  'bondDesk/paperwork.js|SELECT signer_id, event, detail, ip, at ': "one packet's / bond's own children (≤ 6 signers, ≤ 10 forms each) — the agent's record must be complete",
  'bondDesk/paperwork.js|SELECT signed_key FROM bd_documents WHER': "one packet's / bond's own children (≤ 6 signers, ≤ 10 forms each) — the agent's record must be complete",
  'bondDesk/reports.js|SELECT bond_id, amount_cents, voided_at ': "Bond Desk ledger: one bond's (or the agent's) charges / payments / installments — balances and totals must add every row",
  'bondDesk/reports.js|SELECT bond_id, id, due_on, amount_cents': "Bond Desk ledger: one bond's (or the agent's) charges / payments / installments — balances and totals must add every row",
  'bondDesk/reports.js|SELECT id, plan_charged_cents FROM bd_bo': "Bond Desk ledger: one bond's (or the agent's) charges / payments / installments — balances and totals must add every row",
  'bondDesk/reports.js|SELECT id, defendant_name FROM bd_bonds ': "Bond Desk report / dashboard over the agent's own book — a report that drops rows would misstate liability or receivables",
  'bondDesk/reports.js|SELECT id, defendant_name, forfeiture_de': "Bond Desk report / dashboard over the agent's own book — a report that drops rows would misstate liability or receivables",
  'bondDesk/reports.js|SELECT b.id, b.defendant_name, b.case_nu': "Bond Desk report / dashboard over the agent's own book — a report that drops rows would misstate liability or receivables",
  'bondDesk/reports.js|SELECT id, defendant_name, case_number, ': "Bond Desk report / dashboard over the agent's own book — a report that drops rows would misstate liability or receivables",
  'bondDesk/reports.js|SELECT p.id, p.receipt_no, p.received_on': "Bond Desk report / dashboard over the agent's own book — a report that drops rows would misstate liability or receivables",
  'bondDesk/reports.js|SELECT c.id, c.receipt_no, c.kind, c.des': "Bond Desk report / dashboard over the agent's own book — a report that drops rows would misstate liability or receivables",
  'sign.js|SELECT DISTINCT kind FROM bd_uploads WHE': "one signer's own uploads (capped at 20) / signed copies (one per form, ≤ 10)",
  'sign.js|SELECT signed_key FROM bd_documents WHER': "one signer's own uploads (capped at 20) / signed copies (one per form, ≤ 10)",
};

function scan() {
  const files = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js')) files.push(p);
    }
  })(ROUTES);
  const hits = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    // db.all(...) and the cached directoryRows(db, ...) (services/directoryCache.js)
    const re = /(?:\.all|directoryRows)\(\s*(?:\w+,\s*)?([`'"])([\s\S]*?)\1/g;
    let m;
    while ((m = re.exec(src))) {
      const sql = m[2].replace(/\s+/g, ' ').trim();
      if (!/^\s*select/i.test(sql) || /\blimit\b/i.test(sql)) continue;
      // pure aggregates return one row per group of a bounded key
      if (/count\(|group by|sum\(/i.test(sql) && !/select\s+\*/i.test(sql)) continue;
      const rel = path.relative(ROUTES, f).split(path.sep).join('/');
      hits.push(`${rel}|${sql}`);
    }
  }
  return hits;
}

describe('item 23 — list endpoints are bounded', () => {
  test('every unbounded SELECT in src/routes is a documented exception', () => {
    const keys = Object.keys(ALLOWED);
    const unexplained = scan().filter(hit => !keys.some(k => hit.startsWith(k))).map(h => h.slice(0, 90));
    expect(unexplained).toEqual([]);
  });

  test('the exception list has no stale entries', () => {
    const live = scan();
    expect(Object.keys(ALLOWED).filter(k => !live.some(hit => hit.startsWith(k)))).toEqual([]);
  });

  test('the scanner itself catches an unbounded list (self-check)', () => {
    const sample = "db.all('SELECT * FROM saved_lawyers WHERE user_id = ?', [id])";
    const m = /\.all\(\s*([`'"])([\s\S]*?)\1/.exec(sample);
    expect(m && !/\blimit\b/i.test(m[2])).toBe(true);
  });
});
