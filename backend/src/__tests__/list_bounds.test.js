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
  'cases.js|SELECT u.push_token FROM case_family_acc': 'internal push fan-out to one case\'s accepted family members',
  'checkins.js|SELECT DISTINCT ce.user_id FROM checkin_': 'staff-only reminder fan-out (POST), not a list response',
  'conflicts.js|SELECT ci.party_name_orig, ci.party_name': 'conflict check must see every hit (completeness is the point)',
  'conflicts.js|SELECT mp.party_name, mp.party_type, mp.': 'conflict check must see every hit',
  'conflicts.js|SELECT party_name_orig, party_name_norm,': 'conflict index cross-check bounded by the IN list',
  'conflicts.js|SELECT id, control_id, category, title,': 'fixed SOC 2 control catalogue (seeded reference table)',
  'contracts/execution.js|SELECT status FROM contract_executions W': 'one contract\'s signers, internal check',
  'firm_acquisition.js|SELECT tier_key, display_name, monthly_c': 'fixed pricing catalogue',
  'firm_acquisition.js|SELECT checklist_key FROM firm_onboardin': 'fixed onboarding checklist keys',
  'firm_verticals.js|SELECT rule_key, label, days, business_d': 'fixed deadline-preset catalogue',
  'firm_verticals.js|SELECT tier_key, display_name, monthly_c': 'fixed pricing catalogue',
  'integrations/caldav.js|SELECT id, matter_id, firm_id, entry_dat': 'internal sync of one matter\'s pending docket',
  'integrations/dms.js|SELECT id, matter_id, external_doc_id, p': 'internal sync loop',
  'integrations/practice-mgmt.js|SELECT id, matter_id, user_id, aba_code,': 'push of one invoice / matter to the PM system must be complete',
  'messages.js|SELECT ca.defender_id, u.display_name AS': 'active counsel on one case (internal notify)',
  'messages.js|SELECT l.id, l.name, l.firm, l.phone, l.': 'bulk message targets — IN list capped by the route',
  'privilege.js|SELECT ${ENTRY_COLS} FROM privilege_log': 'privilege-log PDF / CSV export must be the complete log',
  'providers.js|SELECT id,name,phone,address,lat,lng,web': 'GPS radius candidates (in memory); the response is capped at 50',
  'providers.js|SELECT id,name,company,phone,address,lat': 'GPS radius candidates (in memory); the response is capped at 50',
  'time.js|SELECT te.*, u.display_name AS attorney_': 'one invoice\'s own line items (invoice view / PDF must be complete)',
  'webhooks/outbound.js|SELECT ${SUB_COLS_WITH_SECRET} FROM webh': 'internal delivery fan-out',
  'webpush.js|SELECT endpoint, p256dh, auth FROM web_p': 'internal push fan-out to one user\'s browsers',
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
    const re = /\.all\(\s*([`'"])([\s\S]*?)\1/g;
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
