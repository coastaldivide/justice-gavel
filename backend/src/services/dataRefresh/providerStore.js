/**
 * dataRefresh/providerStore.js — the only code path through which scrapers and
 * importers touch the provider directory (lawyers, bail_agents,
 * recovery_agents).
 *
 * OWNER RULE (lawyers / bail_agents are real, verified data):
 *   - a record that matches NO existing row is INSERTED (active, unverified,
 *     with source / source_id / created_at / updated_at);
 *   - a record that matches an existing row NEVER writes that row. Each field
 *     whose scraped value differs is staged in provider_update_proposals
 *     (status 'pending') for an admin to apply or reject;
 *   - nothing here deletes, deactivates or hides a row, and rows a scrape does
 *     not return are not looked at.
 *
 * Matching (first hit wins):
 *   1. source id   — Google place id regardless of script prefix, else source_id
 *   2. caller hint — record.matchId (e.g. the DOI importer's fuzzy matcher)
 *   3. phone       — normalized 10-digit number in the same state (placeholders
 *                    never match); with several rows on one number, the one in
 *                    the same city. A match in another city of the state never
 *                    proposes address / lat / lng / hours (that is another office).
 *   4. name+city+state, normalized
 *
 * Idempotency: the table index is loaded once per run and every insert is
 * added to it, so one run never inserts the same provider twice; re-running
 * finds yesterday's inserts by source id. Proposals are unique per
 * (row, field, value) among non-applied rows (migration 15), so re-running
 * only bumps last_seen_at / seen_count.
 *
 * Batching: records are written in chunks, one transaction per chunk, one
 * SAVEPOINT per record (one bad record does not lose the chunk).
 */
import {
  FIELD_RULES, cleanText, normalizePhone, normalizeUrl, normalizeState, nameKey, phoneKey,
  sourceKey, valueText, normalizeCity,
} from './normalize.js';
import { invalidateDirectory } from '../directoryCache.js';

const COMMON_PROPOSABLE = ['phone', 'email', 'address', 'website', 'hours', 'rating', 'reviews', 'lat', 'lng'];

export const PROVIDER_TABLES = {
  lawyers: {
    proposable: [...COMMON_PROPOSABLE, 'bar_number'],
    // columns a scraper may set on a NEW row (beyond name/city/state/source/source_id)
    insertable: ['phone', 'email', 'address', 'website', 'hours', 'rating', 'reviews', 'lat', 'lng',
      'firm', 'bar_number', 'bar_state', 'specialties', 'languages', 'bio', 'pro_bono', 'sliding_scale',
      'free_consultation', 'years_experience', 'verified'],
    defaults: { active: 1, verified: 0, bar_verified: 0, jtb_verified: 0, data_verified: 0, sort_priority: 0,
      specialties: '["Criminal Defense"]', languages: '["English"]' },
  },
  bail_agents: {
    proposable: [...COMMON_PROPOSABLE, 'license_number', 'license_type', 'doi_verified'],
    insertable: ['phone', 'email', 'address', 'website', 'hours', 'rating', 'reviews', 'lat', 'lng',
      'company', 'license_number', 'license_type', 'doi_verified', 'bio', 'available_24_7', 'verified'],
    defaults: { active: 1, verified: 0, doi_verified: 0 },
  },
  recovery_agents: {
    proposable: [...COMMON_PROPOSABLE, 'license_number', 'available_24_7'],
    insertable: ['phone', 'email', 'address', 'website', 'hours', 'rating', 'reviews', 'lat', 'lng',
      'license_number', 'available_24_7', 'bio'],
    defaults: { active: 1 },
  },
};

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;
const LOCATION_FIELDS = new Set(['address', 'lat', 'lng', 'hours']);

export function tableConfig(table) {
  const cfg = PROVIDER_TABLES[table];
  if (!cfg) throw new Error(`not a provider table: ${table}`);
  return cfg;
}

export function isProposableField(table, field) {
  return !!PROVIDER_TABLES[table]?.proposable.includes(field) && !!FIELD_RULES[field];
}

// ── In-memory index of one table ────────────────────────────────────────────
class TableIndex {
  constructor(table) {
    this.table = table;
    this.bySource = new Map();
    this.byPhone = new Map();
    this.byName = new Map();
    this.byId = new Map();
    this.nextFakeId = -1;   // dry-run inserts
  }
  add(row) {
    this.byId.set(Number(row.id), row);
    const s = sourceKey(row.source_id);
    if (s && !this.bySource.has(s)) this.bySource.set(s, row);
    const p = phoneKey(row.phone);
    if (p) { if (!this.byPhone.has(p)) this.byPhone.set(p, []); this.byPhone.get(p).push(row); }
    const n = nameKey(row.name, row.city, row.state);
    if (n && !this.byName.has(n)) this.byName.set(n, row);
  }
  match(rec) {
    const s = sourceKey(rec.source_id);
    if (s && this.bySource.has(s)) return { row: this.bySource.get(s), by: 'source_id' };
    if (rec.matchId != null && this.byId.has(Number(rec.matchId))) return { row: this.byId.get(Number(rec.matchId)), by: 'hint' };
    const p = phoneKey(rec.phone);
    if (p && this.byPhone.has(p)) {
      // a number shared across states (a chain's call centre) is not the same listing
      const rows = this.byPhone.get(p).filter(r => r.state === rec.state);
      const c = normalizeCity(rec.city);
      const sameCity = rows.find(r => normalizeCity(r.city) === c);
      if (rows.length) return { row: sameCity || rows[0], by: sameCity ? 'phone' : 'phone_other_city' };
    }
    const n = nameKey(rec.name, rec.city, rec.state);
    if (n && this.byName.has(n)) return { row: this.byName.get(n), by: 'name' };
    return null;
  }
}

/** Build a match index from rows already in memory (used by loadIndex; exported for tests). */
export function buildIndex(table, rows) {
  tableConfig(table);
  const idx = new TableIndex(table);
  for (const r of rows) idx.add(r);
  return idx;
}

async function loadIndex(db, table) {
  const cfg = tableConfig(table);
  const cols = ['id', 'source_id', 'name', 'city', 'state', ...new Set(cfg.proposable)];
  const idx = buildIndex(table, await db.all(`SELECT ${cols.join(', ')} FROM ${table}`));
  idx.suppressed = await loadSuppressions(db, table);
  return idx;
}

/**
 * source_ids the owner removed on purpose (migration 016 provider_suppressions).
 * A scrape must never re-add them. Missing table (older schema) = none.
 */
export async function loadSuppressions(db, table) {
  try {
    const rows = await db.all('SELECT source_id FROM provider_suppressions WHERE table_name = ?', [table]);
    return new Set(rows.map(r => sourceKey(r.source_id)).filter(Boolean));
  } catch (e) {
    if (/provider_suppressions/.test(String(e && e.message))) return new Set();
    throw e;
  }
}

// ── Record validation / shaping ─────────────────────────────────────────────
/**
 * Normalize a scraped record into column values. Returns { ok, reason, rec }.
 * Rejects records without a usable name / city / state; never invents data.
 */
export function prepareRecord(table, raw) {
  const cfg = tableConfig(table);
  const name = cleanText(raw.name, 200);
  if (!name || !/[A-Za-z]{2}/.test(name) || name.length < 3) return { ok: false, reason: 'no_name' };
  const state = normalizeState(raw.state);
  if (!state) return { ok: false, reason: 'no_state' };
  const city = cleanText(raw.city, 120);
  if (!city) return { ok: false, reason: 'no_city' };
  if (raw.business_status === 'CLOSED_PERMANENTLY') return { ok: false, reason: 'closed' };

  const rec = {
    name, city, state,
    source: cleanText(raw.source, 60) || 'scrape',
    source_id: cleanText(raw.source_id, 300),
    matchId: raw.matchId ?? null,
  };
  for (const f of cfg.insertable) {
    if (raw[f] === undefined || raw[f] === null || raw[f] === '') continue;
    if (FIELD_RULES[f]) {
      const v = FIELD_RULES[f].format(raw[f]);
      if (v !== null && v !== undefined) rec[f] = v;
    } else if (f === 'specialties' || f === 'languages') {
      rec[f] = Array.isArray(raw[f]) ? JSON.stringify(raw[f].map(s => cleanText(s, 60)).filter(Boolean)) : cleanText(raw[f], 500);
    } else if (['pro_bono', 'sliding_scale', 'free_consultation', 'verified', 'years_experience'].includes(f)) {
      const n = Number(raw[f]); if (Number.isFinite(n)) rec[f] = Math.round(n);
    } else {
      rec[f] = cleanText(raw[f], f === 'bio' ? 2000 : 300);
    }
  }
  if (rec.phone && !phoneKey(rec.phone)) delete rec.phone;            // placeholder numbers are not data
  if (rec.website) rec.website = normalizeUrl(rec.website);
  return { ok: true, rec };
}

// ── Writes ──────────────────────────────────────────────────────────────────
async function insertRow(tx, table, rec) {
  const cfg = tableConfig(table);
  const now = new Date().toISOString();
  const values = { ...cfg.defaults, name: rec.name, city: rec.city, state: rec.state,
    source: rec.source, source_id: rec.source_id || null, created_at: now, updated_at: now };
  for (const f of cfg.insertable) if (rec[f] !== undefined) values[f] = rec[f];
  // Never let a column default invent a rating for a provider nobody rated.
  if (values.rating === undefined) values.rating = null;
  if (table === 'lawyers' && values.reviews !== undefined) values.review_count = Number(values.reviews) || 0;
  if (table === 'recovery_agents' && values.rating === null) values.rating = 0;   // NOT NULL-ish legacy default
  const cols = Object.keys(values).filter(c => SAFE_IDENT.test(c));
  const castValues = cols.map(c => (FIELD_RULES[c] && FIELD_RULES[c].kind !== 'text' && values[c] !== null)
    ? Number(values[c]) : values[c]);
  const row = await tx.get(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
     ${table === 'recovery_agents' ? 'ON CONFLICT (source_id) DO NOTHING' : ''}
     RETURNING id, source_id, name, city, state, ${tableConfig(table).proposable.join(', ')}`,
    castValues,
  );
  return row || null;
}

async function stageProposal(tx, { table, recordId, field, oldValue, newValue, source, sourceRef, runId }) {
  const open = await tx.get(
    `SELECT id, status FROM provider_update_proposals
      WHERE table_name = ? AND record_id = ? AND field = ? AND new_value_hash = md5(?) AND status <> 'applied'`,
    [table, recordId, field, newValue],
  );
  let id; let outcome;
  if (!open) {
    const r = await tx.get(
      `INSERT INTO provider_update_proposals
         (table_name, record_id, field, old_value, new_value, source, source_ref, run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (table_name, record_id, field, new_value_hash) WHERE status <> 'applied' DO NOTHING
       RETURNING id`,
      [table, recordId, field, oldValue, newValue, source, sourceRef, runId],
    );
    if (!r) return 'already_pending';
    id = r.id; outcome = 'new';
  } else if (open.status === 'pending') {
    await tx.run(`UPDATE provider_update_proposals SET last_seen_at = NOW(), seen_count = seen_count + 1, run_id = COALESCE(?, run_id)
                   WHERE id = ?`, [runId, open.id]);
    return 'already_pending';
  } else if (open.status === 'rejected') {
    return 'rejected_before';
  } else {   // superseded → the value is back: revive it
    await tx.run(`UPDATE provider_update_proposals SET status = 'pending', old_value = ?, last_seen_at = NOW(),
                         seen_count = seen_count + 1, run_id = COALESCE(?, run_id)
                   WHERE id = ?`, [oldValue, runId, open.id]);
    id = open.id; outcome = 'revived';
  }
  // A newer value for the same field replaces older pending ones.
  await tx.run(`UPDATE provider_update_proposals SET status = 'superseded', decided_at = NOW(),
                       decision_note = 'superseded by proposal ' || ?::text
                 WHERE table_name = ? AND record_id = ? AND field = ? AND status = 'pending' AND id <> ?`,
  [String(id), table, recordId, field, id]);
  return outcome;
}

/** Field-level differences between an existing row and a prepared record. */
export function diffRecord(table, existing, rec) {
  const out = [];
  for (const field of tableConfig(table).proposable) {
    const rule = FIELD_RULES[field];
    const incoming = rec[field];
    if (!rule || incoming === undefined || incoming === null) continue;
    if (field === 'phone' && !phoneKey(incoming)) continue;
    if (rule.same(existing[field], incoming)) continue;
    out.push({ field, oldValue: valueText(existing[field]), newValue: String(incoming) });
  }
  return out;
}

/**
 * Create a writer bound to one table and one run.
 *   const w = createProviderWriter(db, 'lawyers', { runId, dryRun, counts, errorSamples });
 *   await w.writeAll(records);   // counts are accumulated into `counts`
 */
export function createProviderWriter(db, table, { runId = null, dryRun = false, counts, errorSamples = [], chunkSize = 50, onResult } = {}) {
  tableConfig(table);
  let indexPromise = null;
  const index = () => (indexPromise ||= loadIndex(db, table));

  async function handle(tx, idx, raw) {
    const prep = prepareRecord(table, raw);
    if (!prep.ok) return { result: 'skipped', reason: prep.reason };
    const rec = prep.rec;
    if (rec.source_id && idx.suppressed && idx.suppressed.has(sourceKey(rec.source_id))) {
      return { result: 'skipped', reason: 'suppressed' };
    }
    const hit = idx.match(rec);
    if (!hit) {
      if (dryRun) {
        idx.add({ ...rec, id: idx.nextFakeId-- });
        return { result: 'inserted', dry: true };
      }
      const row = await insertRow(tx, table, rec);
      if (!row) return { result: 'unchanged', reason: 'conflict' };
      return { result: 'inserted', row };
    }
    let diffs = diffRecord(table, hit.row, rec);
    // Same phone, different city: one business with several offices. Its
    // location fields describe the OTHER office — never propose them.
    if (hit.by === 'phone_other_city') diffs = diffs.filter(d => !LOCATION_FIELDS.has(d.field));
    if (!diffs.length) return { result: 'unchanged', matchedBy: hit.by, id: hit.row.id };
    if (dryRun || Number(hit.row.id) < 0) return { result: 'proposed', proposals: diffs.length, matchedBy: hit.by, id: hit.row.id, dry: true };
    let created = 0;
    for (const d of diffs) {
      const outcome = await stageProposal(tx, {
        table, recordId: Number(hit.row.id), field: d.field, oldValue: d.oldValue, newValue: d.newValue,
        source: rec.source, sourceRef: rec.source_id, runId,
      });
      if (outcome === 'new' || outcome === 'revived') created++;
    }
    return created
      ? { result: 'proposed', proposals: created, matchedBy: hit.by, id: hit.row.id }
      : { result: 'unchanged', matchedBy: hit.by, id: hit.row.id, reason: 'already_staged' };
  }

  function tally(out) {
    if (!counts) return;
    if (out.result === 'inserted') counts.inserted++;
    else if (out.result === 'proposed') counts.proposed += out.proposals || 1;
    else if (out.result === 'unchanged') counts.unchanged++;
    else if (out.result === 'skipped') counts.skipped++;
    else if (out.result === 'error') counts.errors++;
  }

  async function writeChunk(idx, chunk) {
    const results = [];
    if (dryRun) {
      for (const raw of chunk) results.push(await handle(null, idx, raw));
      return results;
    }
    await db.transaction(async (tx) => {
      for (let i = 0; i < chunk.length; i++) {
        await tx.exec('SAVEPOINT rec');
        try {
          const out = await handle(tx, idx, chunk[i]);
          await tx.exec('RELEASE SAVEPOINT rec');
          results.push(out);
        } catch (e) {
          await tx.exec('ROLLBACK TO SAVEPOINT rec');
          errorSamples.push(`${table} "${String(chunk[i]?.name || '?').slice(0, 80)}": ${e.message}`);
          results.push({ result: 'error', error: e.message });
        }
      }
    });
    invalidateDirectory();
    // only rows that are committed join the index
    for (const out of results) if (out.result === 'inserted' && out.row) idx.add(out.row);
    return results;
  }

  return {
    table,
    async writeAll(records) {
      const idx = await index();
      const all = [];
      // within one chunk, a later duplicate must see an earlier insert → split
      // chunks so a record never shares a chunk with one it matches.
      for (let i = 0; i < records.length; i += chunkSize) {
        const chunk = records.slice(i, i + chunkSize);
        let results;
        try {
          results = await writeChunkDeduped(idx, chunk);
        } catch (e) {
          errorSamples.push(`${table} chunk: ${e.message}`);
          results = chunk.map(() => ({ result: 'error', error: e.message }));
        }
        for (const out of results) { tally(out); onResult?.(out); }
        all.push(...results);
      }
      return all;
    },
  };

  // Records in one chunk that would match each other (same place / phone /
  // name) are moved to a follow-up chunk so the second sees the first's row.
  async function writeChunkDeduped(idx, chunk) {
    const seen = new Set();
    const now = []; const later = [];
    for (const raw of chunk) {
      const p = prepareRecord(table, raw);
      const keys = p.ok ? [sourceKey(p.rec.source_id), phoneKey(p.rec.phone), nameKey(p.rec.name, p.rec.city, p.rec.state)].filter(Boolean) : [];
      if (keys.some(k => seen.has(k))) later.push(raw);
      else { keys.forEach(k => seen.add(k)); now.push(raw); }
    }
    const out = await writeChunk(idx, now);
    if (later.length) out.push(...await writeChunkDeduped(idx, later));
    return out;
  }
}

export { normalizePhone };
