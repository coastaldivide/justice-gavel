/**
 * sourceChecks/reviews.js — the admin review queue for source re-checks (Admin → Source checks).
 *
 * Nothing in the queue changes a row until an admin decides, and every decision is written to
 * audit_log in the same transaction (resource_type 'legal_source', resource_id '<dataset>:<key>'):
 *
 *   approve   re-check: the admin confirms the row as stored still matches its page → its
 *             "checked on" date becomes today (a withhold is lifted).
 *             proposal: the admin accepts the proposed official page as the row's source →
 *             database rows get that source_url + a "Source-checked <date> … approved by an admin"
 *             verifier, so a withheld row is shown from now on (a human approved it); rows that
 *             live in code record the approved source (shown where the screen has a source link).
 *   edit      database rows: the admin's corrected text (only the table's text columns) and,
 *             optionally, a new official source → saved, dated today.
 *             rows in code: the correction is recorded for a developer and the row is WITHHELD
 *             until the code is changed and the row restored (GET …/corrections lists them).
 *   withhold  the row stops being shown (database and code rows alike) until restored.
 *   restore   (per row) lifts a withhold / clears an applied correction.
 */
import { allRows, findRowIn, DB_DATASETS, CODE_DATASETS, DATASETS } from './registry.js';
import { isAllowedUrl } from '../../ai/sourceDomains.js';
import { refreshOverlayRow } from './overlayStore.js';

export class ReviewError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}
export const REVIEW_STATUSES = ['pending', 'approved', 'edited', 'withheld', 'superseded'];
const today = () => new Date().toISOString().slice(0, 10);
const clamp = (v, d, lo, hi) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : d; };

export async function listReviews(db, q = {}) {
  const where = []; const params = [];
  const status = REVIEW_STATUSES.includes(q.status) ? q.status : q.status === 'all' ? null : 'pending';
  if (status) { where.push('status = ?'); params.push(status); }
  if (q.dataset) {
    if (!DATASETS.includes(q.dataset)) throw new ReviewError(400, 'bad_dataset');
    where.push('dataset = ?'); params.push(q.dataset);
  }
  const limit = clamp(q.limit, 50, 1, 200); const offset = clamp(q.offset, 0, 0, 1_000_000);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.all(
    `SELECT id, dataset, row_key, kind, label, state, source_url, old_text, verdict, quote, quote_verified, reason, what_changed,
            fetched_url, proposed_source_url, batch_id, status, decided_by, decided_at, decision_note, edited_text, created_at
       FROM legal_source_reviews ${w} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  const total = await db.get(`SELECT COUNT(*)::int AS n FROM legal_source_reviews ${w}`, params);
  const pending = await db.get(`SELECT COUNT(*)::int AS n FROM legal_source_reviews WHERE status = 'pending'`);
  return { total: total?.n ?? 0, pending: pending?.n ?? 0, limit, offset,
    rows: rows.map((r) => ({ ...r, id: Number(r.id), editable: editableFor(r.dataset) })) };
}

/** What "edit" means for a dataset: { kind: 'fields', fields } | { kind: 'correction' } | null. */
export function editableFor(dataset) {
  if (CODE_DATASETS.has(dataset)) return { kind: 'correction' };
  const d = DB_DATASETS[dataset];
  return d && d.editable.length ? { kind: 'fields', fields: d.editable } : null;
}

async function audit(tx, userId, action, review, details) {
  await tx.run(
    `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, entity_type)
     VALUES (?, ?, 'legal_source', ?, ?, 'legal_source_review')`,
    [userId ?? null, action, `${review.dataset}:${review.row_key}`, JSON.stringify({ review_id: Number(review.id), verdict: review.verdict, kind: review.kind, ...details })]);
}

async function upsertCheck(tx, dataset, key, sourceUrl, fields) {
  const cols = Object.keys(fields);
  await tx.run(
    `INSERT INTO legal_source_checks (dataset, row_key, source_url, ${cols.join(', ')}, updated_at)
     VALUES (?, ?, ?, ${cols.map(() => '?').join(', ')}, NOW())
     ON CONFLICT (dataset, row_key) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = NOW()`,
    [dataset, String(key), sourceUrl, ...cols.map((c) => fields[c])]);
}

const verifierLine = (how) => `Source-checked ${today()} — ${how} (automatic source check; not attorney-reviewed)`;

/**
 * Decide one review. body: { action: 'approve' | 'edit' | 'withhold', note?, fields?, source_url?, text? }
 * → { id, status, dataset, row_key, published?, needs_developer? }
 */
export async function decideReview(db, id, body = {}, { userId = null } = {}) {
  const rid = parseInt(id, 10);
  if (!Number.isFinite(rid)) throw new ReviewError(400, 'bad_id');
  const action = String(body.action || '');
  if (!['approve', 'edit', 'withhold'].includes(action)) throw new ReviewError(400, 'bad_action');
  const note = body.note ? String(body.note).slice(0, 500) : null;
  const rows = await allRows(db);
  const out = await db.transaction(async (tx) => {
    const r = await tx.get('SELECT * FROM legal_source_reviews WHERE id = ? FOR UPDATE', [rid]);
    if (!r) throw new ReviewError(404, 'not_found');
    if (r.status !== 'pending') throw new ReviewError(409, 'not_pending');
    const row = findRowIn(rows, r.dataset, r.row_key);
    if (!row) throw new ReviewError(409, 'row_missing');
    const db_ = row.storage === 'db' ? DB_DATASETS[row.table] : null;
    const result = { id: rid, dataset: r.dataset, row_key: r.row_key };

    if (action === 'approve') {
      if (r.kind === 'proposal') {
        const url = String(r.proposed_source_url || '');
        if (!isAllowedUrl(url)) throw new ReviewError(409, 'source_not_allowed');
        await upsertCheck(tx, r.dataset, r.row_key, row.source_url, { checked_on: today(), checked_how: 'admin_approved', approved_source_url: url,
          approved_by: userId, approved_at: new Date().toISOString(), withheld: false, withheld_reason: null });
        if (db_) {
          if (row.table === 'rights_cards') await tx.run('UPDATE rights_cards SET source_url = ?, content_verified_at = NOW() WHERE id = ?', [url, row.id]);
          else await tx.run(`UPDATE ${row.table} SET source_url = ?, verified_by = ?, last_reviewed_at = NOW(), updated_at = NOW() WHERE id = ?`,
            [url, verifierLine(`source approved by an admin from a proposal`), row.id]);
          result.published = true;
        } else {
          // In code: the approved source is shown where the screen has a source link (rights card,
          // deadline calculator, record clearing, recording law); a withheld code row needs its
          // data researched / regenerated by a developer before it can be shown.
          result.published = row.shown;
          result.needs_developer = !row.shown;
        }
      } else {
        await upsertCheck(tx, r.dataset, r.row_key, row.source_url, { checked_on: today(), checked_how: 'admin_approved', withheld: false, withheld_reason: null });
        if (db_) await tx.run(`UPDATE ${row.table} SET ${row.table === 'rights_cards' ? 'content_verified_at' : 'last_reviewed_at'} = NOW() WHERE id = ?`, [row.id]);
      }
      await tx.run(`UPDATE legal_source_reviews SET status = 'approved', decided_by = ?, decided_at = NOW(), decision_note = ? WHERE id = ?`, [userId, note, rid]);
      await audit(tx, userId, 'admin.source_check_approved', r, { note: note || undefined, proposed_source_url: r.proposed_source_url || undefined });
      return { ...result, status: 'approved' };
    }

    if (action === 'edit') {
      const ed = editableFor(r.dataset);
      if (!ed) throw new ReviewError(409, 'not_editable');
      if (ed.kind === 'fields') {
        const fields = body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields) ? body.fields : {};
        const cols = Object.keys(fields).filter((c) => ed.fields.includes(c));
        if (!cols.length || cols.some((c) => typeof fields[c] !== 'string' || !fields[c].trim() || fields[c].length > 4000)) throw new ReviewError(400, 'bad_fields');
        const src = body.source_url ? String(body.source_url).trim() : null;
        if (src && !isAllowedUrl(src)) throw new ReviewError(400, 'source_not_allowed');
        const before = await tx.get(`SELECT ${cols.join(', ')}, source_url FROM ${row.table} WHERE id = ? FOR UPDATE`, [row.id]);
        await tx.run(`UPDATE ${row.table} SET ${cols.map((c) => `${c} = ?`).join(', ')}${src ? ', source_url = ?' : ''}, verified_by = ?, last_reviewed_at = NOW(), updated_at = NOW() WHERE id = ?`,
          [...cols.map((c) => fields[c].trim()), ...(src ? [src] : []), verifierLine('corrected by an admin'), row.id]);
        await upsertCheck(tx, r.dataset, r.row_key, src || row.source_url, { checked_on: today(), checked_how: 'admin_edited', withheld: false, withheld_reason: null });
        const edited = cols.map((c) => `${c}: ${fields[c].trim()}`).join('\n');
        await tx.run(`UPDATE legal_source_reviews SET status = 'edited', decided_by = ?, decided_at = NOW(), decision_note = ?, edited_text = ? WHERE id = ?`, [userId, note, edited, rid]);
        await audit(tx, userId, 'admin.source_check_edited', r, { before, after: Object.fromEntries(cols.map((c) => [c, fields[c].trim()])), source_url: src || undefined, note: note || undefined });
        return { ...result, status: 'edited', published: row.shown || !!src };
      }
      const text = String(body.text || '').trim();
      if (!text || text.length > 4000) throw new ReviewError(400, 'bad_text');
      await upsertCheck(tx, r.dataset, r.row_key, row.source_url, { correction: text, withheld: true, withheld_reason: 'correction_pending_deploy' });
      await tx.run(`UPDATE legal_source_reviews SET status = 'edited', decided_by = ?, decided_at = NOW(), decision_note = ?, edited_text = ? WHERE id = ?`, [userId, note, text, rid]);
      await audit(tx, userId, 'admin.source_check_edited', r, { correction: text, withheld_until_deploy: true, note: note || undefined });
      return { ...result, status: 'edited', needs_developer: true, withheld: true };
    }

    // withhold
    await upsertCheck(tx, r.dataset, r.row_key, row.source_url, { withheld: true, withheld_reason: note || 'withheld by an admin after a source check' });
    await tx.run(`UPDATE legal_source_reviews SET status = 'withheld', decided_by = ?, decided_at = NOW(), decision_note = ? WHERE id = ?`, [userId, note, rid]);
    await audit(tx, userId, 'admin.source_check_withheld', r, { note: note || undefined });
    return { ...result, status: 'withheld', withheld: true };
  });
  await refreshOverlayRow(db, out.dataset, out.row_key);
  return out;
}

/** Lift a withhold (after a developer applied a correction, or a withhold was a mistake). */
export async function restoreRow(db, dataset, key, { userId = null, note = null } = {}) {
  if (!DATASETS.includes(String(dataset))) throw new ReviewError(400, 'bad_dataset');
  const out = await db.transaction(async (tx) => {
    const c = await tx.get('SELECT * FROM legal_source_checks WHERE dataset = ? AND row_key = ? FOR UPDATE', [dataset, String(key)]);
    if (!c || !c.withheld) throw new ReviewError(409, 'not_withheld');
    await tx.run(`UPDATE legal_source_checks SET withheld = FALSE, withheld_reason = NULL, correction = NULL, updated_at = NOW() WHERE dataset = ? AND row_key = ?`, [dataset, String(key)]);
    await tx.run(`INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, entity_type) VALUES (?, 'admin.source_check_restored', 'legal_source', ?, ?, 'legal_source_check')`,
      [userId, `${dataset}:${key}`, JSON.stringify({ previous_reason: c.withheld_reason, correction: c.correction || undefined, note: note ? String(note).slice(0, 500) : undefined })]);
    return { dataset, row_key: String(key), withheld: false };
  });
  await refreshOverlayRow(db, dataset, key);
  return out;
}

/** Rows withheld after a check, and corrections a developer still has to apply in code. */
export async function listWithheld(db) {
  const rows = await db.all(
    `SELECT dataset, row_key, source_url, withheld_reason, correction, checked_on, updated_at FROM legal_source_checks
      WHERE withheld ORDER BY updated_at DESC LIMIT 500`);
  return rows;
}

/** The overview for the admin screen: counts per dataset and mode, last runs. */
export async function overview(db) {
  const { checkMode } = await import('./registry.js');
  const rows = await allRows(db);
  const state = new Map((await db.all('SELECT dataset, row_key, checked_on, last_outcome, withheld FROM legal_source_checks ORDER BY dataset, row_key LIMIT 20000'))
    .map((r) => [`${r.dataset}|${r.row_key}`, r]));
  const per = {};
  for (const r of rows) {
    const p = per[r.dataset] || (per[r.dataset] = { dataset: r.dataset, rows: 0, shown: 0, recheck: 0, propose: 0, not_official: 0, no_url: 0, verified_by_check: 0, withheld_by_admin: 0 });
    p.rows += 1; if (r.shown) p.shown += 1;
    p[checkMode(r)] += 1;
    const s = state.get(`${r.dataset}|${r.key}`);
    if (s?.last_outcome === 'verified') p.verified_by_check += 1;
    if (s?.withheld) p.withheld_by_admin += 1;
  }
  const runs = await db.all(`SELECT id, status, item_count, cost_usd, worst_case_usd, output, meta, created_at, processed_at, error FROM ai_batches WHERE kind = 'source_check' ORDER BY id DESC LIMIT 10`);
  return { datasets: Object.values(per), runs: runs.map((b) => ({ ...b, id: Number(b.id), cost_usd: Number(b.cost_usd || 0), worst_case_usd: b.worst_case_usd == null ? null : Number(b.worst_case_usd) })) };
}
