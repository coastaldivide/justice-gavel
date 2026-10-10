/**
 * arrestVisibility.js — the ONE place that decides which arrest_records rows
 * may be shown to users or acted on by automated jobs.
 *
 * Why: supabase/migrations/00000000000001_seed_reference_data.sql seeds 600
 * GENERATED arrest rows (source = 'seed_v1') with realistic names, jails and
 * case numbers. Presenting those as real bookings — or texting, emailing or
 * billing anyone because of them — is a defamation / false-light and
 * consumer-protection risk. The rows stay in the database; they are filtered
 * out at read time.
 *
 * Two filters:
 *   realArrestSql()     — automated / money paths (arrest alerts, outbound bot,
 *                         lead purchase, family connect, payment links, lead
 *                         delivery). NEVER includes sample rows, whatever the
 *                         toggle says, and never suppressed (taken-down) rows.
 *   visibleArrestSql()  — read-only user-facing lists and detail views. Same as
 *                         realArrestSql() unless SHOW_SAMPLE_ARRESTS=true, in
 *                         which case sample rows are included (for demos) and
 *                         the API marks them `is_sample: true` (isSampleSql()).
 *
 * A "sample" row is one whose `source` starts with seed / sample / demo / mock /
 * fake / test (case-insensitive) followed by a non-letter or the end, e.g.
 * 'seed_v1', 'sample', 'demo-2026'. Rows with a NULL source are treated as real.
 *
 * The SQL fragments are Postgres (~* regex). They contain no `?` placeholders,
 * so they can be dropped into any query built for db/index.js.
 */

export const SAMPLE_SOURCE_PATTERN = '^(seed|sample|demo|mock|fake|test)([^a-z]|$)';
const SAMPLE_SOURCE_RE = new RegExp(SAMPLE_SOURCE_PATTERN, 'i');

/** SHOW_SAMPLE_ARRESTS=true re-enables sample rows on read-only user views. Default off. */
export function sampleArrestsEnabled() {
  return String(process.env.SHOW_SAMPLE_ARRESTS || '').trim().toLowerCase() === 'true';
}

/** JS twin of isSampleSql() for rows already in memory. */
export function isSampleSource(source) {
  return SAMPLE_SOURCE_RE.test(String(source ?? ''));
}

function col(alias, name) {
  if (alias && !/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`arrestVisibility: bad alias ${alias}`);
  return alias ? `${alias}.${name}` : name;
}

/** SQL boolean: the row is generated sample data. */
export function isSampleSql(alias = '') {
  return `(COALESCE(${col(alias, 'source')}, '') ~* '${SAMPLE_SOURCE_PATTERN}')`;
}

/** SQL boolean: the row has not been suppressed by a takedown request. */
function notSuppressedSql(alias = '') {
  return `COALESCE(${col(alias, 'suppressed')}, 0) = 0`;
}

/** SQL boolean for automated / billing paths: real, non-suppressed rows only. */
export function realArrestSql(alias = '') {
  return `(NOT ${isSampleSql(alias)} AND ${notSuppressedSql(alias)})`;
}

/** SQL boolean for read-only user views (samples only with SHOW_SAMPLE_ARRESTS=true). */
export function visibleArrestSql(alias = '') {
  return sampleArrestsEnabled() ? `(${notSuppressedSql(alias)})` : realArrestSql(alias);
}

/** SELECT-list expression that yields the `is_sample` boolean column. */
export function isSampleColumnSql(alias = '') {
  return `${isSampleSql(alias)} AS is_sample`;
}
