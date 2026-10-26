import { safeJson, safeInt } from '../utils/routeHelpers.js';
/**
 * GET /api/legaldata/:type — public, read-only legal reference data by state
 * (guests reach DUI laws, drug penalties, courts and clinics from Home).
 * Types: bail, dui, drugs, sol, federal-courts, victim-comp, clinics, bar-complaints, …
 *
 * meta: { type, state, count, disclaimer (request language), source_labels,
 *         recorded_at (when the rows were imported), last_verified (latest
 *         last_reviewed_at — null when no row was ever reviewed), reviewed }
 * The rows carry their own `source` / `source_url`; nothing here says the data
 * was verified unless a row records a review.
 */
import { createHash } from 'node:crypto';
import { Router } from "express";
import { getDb }   from "../db/index.js";
import { apiLimiter } from '../middleware/rateLimiters.js';
import { msg, resolveLang } from '../i18n/index.js';
import logger from '../utils/logger.js';

const router = Router();

const md5 = (s) => createHash('md5').update(String(s), 'utf8').digest('hex');

/**
 * Replace English text fields with the stored translation for `lang`
 * (content_translations, migration 26) — only while the row's English still
 * matches the text the translation was made from (source_md5), so an edited
 * row falls back to English. Each row gets `text_lang`: the language its
 * free-text fields are in ('en' when nothing was translated).
 */
async function applyTranslations(db, table, rows, lang) {
  for (const r of rows) r.text_lang = 'en';
  if (lang === 'en' || !rows.length) return;
  const ids = rows.map(r => r.id).filter(id => Number.isSafeInteger(Number(id)));
  if (!ids.length) return;
  const marks = ids.map(() => '?').join(',');
  const tr = await db.all(
    `SELECT row_id, field, text, source_md5 FROM content_translations
      WHERE table_name = ? AND lang = ? AND row_id IN (${marks})`, [table, lang, ...ids]);
  const byRow = new Map(rows.map(r => [String(r.id), r]));
  const done = new Map();
  for (const t of tr) {
    const r = byRow.get(String(t.row_id));
    if (!r || typeof r[t.field] !== 'string' || md5(r[t.field]) !== t.source_md5) continue;
    r[t.field] = t.text;
    done.set(r, (done.get(r) || 0) + 1);
  }
  for (const r of done.keys()) r.text_lang = lang;
}

const TABLE_MAP = {
  "bail":           { table: "bail_schedules",        stateCol: "state" },
  "dui":            { table: "dui_laws",              stateCol: "state" },
  "drugs":          { table: "drug_penalties",        stateCol: "state" },
  "sol":            { table: "statute_of_limitations",stateCol: "state" },
  "federal-courts": { table: "federal_courts",        stateCol: "state" },
  "victim-comp":    { table: "victim_compensation",   stateCol: "state" },
  "clinics":        { table: "law_school_clinics",    stateCol: "state" },
  "bar-complaints": { table: "state_bar_complaints",  stateCol: "state" },
  "probation":     { table: "probation_offices",        stateCol: "state" },
  "specialty-courts": { table: "specialty_courts",         stateCol: "state" },
  "courthouses":   { table: "courthouses",              stateCol: "state" },
};

/**
 * Legal-rule tables: a row is served ONLY when it names the official page it was
 * checked against (source_url) and who checked it (verified_by). Before the Oct 2026
 * legal accuracy review none of these rows had either, and research found most of the
 * checked rows wrong (penalty ranges, deadlines, award caps, invented court details).
 * Unchecked rows are withheld, never shown as fact; meta.withheld counts them so the
 * screen can say "not verified yet for this state" instead of "nothing found".
 * Directory tables (courts, clinics, probation offices, bar-complaint offices) are contact listings, not
 * statements of law, and are not gated here.
 */
export const VERIFIED_ONLY = new Set(['bail', 'dui', 'drugs', 'sol', 'victim-comp', 'specialty-courts']);
// Accepted verifiers: this review's marker ("Source-checked YYYY-MM-DD …", migration 30 and
// later research passes) or a lawyer ("Attorney: name, bar no."). The single seeded row marked
// "Legal audit May 2026" (TN DUI) had no recorded method and the Oct 2026 research could not
// confirm it (minimum jail stored as 48 "days" is 48 hours), so free-text claims don't count.
const ACCEPTED_VERIFIER = /^(Source-checked \d{4}-\d{2}-\d{2}|Attorney:)/;
export const isVerifiedRow = (r) =>
  !!r && typeof r.source_url === 'string' && /^https?:\/\//i.test(r.source_url.trim())
      && typeof r.verified_by === 'string' && ACCEPTED_VERIFIER.test(r.verified_by.trim());

router.get("/:type", apiLimiter, async (req, res) => {
  const lang = resolveLang(req);
  try {
    const { type } = req.params;
    const { state, q } = req.query;
    const cfg = TABLE_MAP[type];
    if (!cfg) return res.status(404).json({ error: 'unknown_type', code: 'unknown_type', message: msg(lang, 'legaldata.err.unknown_type') });

    const db = await getDb();
    // SELECT * is intentional here — each table in TABLE_MAP has a different schema.
    // The table name is constrained to TABLE_MAP keys (allowlist), never from user input.
    let sql = `SELECT * FROM ${cfg.table} WHERE 1=1 /* intentional: TABLE_MAP allowlist constrains table name */`;
    const params = [];

    if (state) {
      // Also include national records (state="ALL" or "FED") plus specific state
      sql += ` AND (UPPER(${cfg.stateCol})=? OR ${cfg.stateCol} IN ('ALL','FED'))`;
      params.push(String(state).toUpperCase().slice(0, 3));
    }
    sql += " ORDER BY id ASC LIMIT 500";

    let rows = await db.all(sql, params);
    let withheld = 0;
    if (VERIFIED_ONLY.has(type)) {
      const before = rows.length;
      rows = rows.filter(isVerifiedRow);
      withheld = before - rows.length;
    }
    // Free-text filter across the row's text columns (tables have different schemas)
    if (q) {
      const needle = String(q).trim().toLowerCase().slice(0, 100);
      rows = rows.filter(r => Object.values(r).some(v => typeof v === 'string' && v.toLowerCase().includes(needle)));
    }
    const lim = Math.min(Math.max(safeInt(req.query.limit, 500), 1), 500);
    rows = rows.slice(0, lim);

    // Parse JSON columns
    const parsed = rows.map(r => {
      if (r.covers) r.covers = safeJson(r.covers);
      return r;
    });
    await applyTranslations(db, cfg.table, parsed, lang);

    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    res.setHeader('Vary', 'Accept-Language');

    const times = (k) => parsed.map(r => r[k]).filter(Boolean).map(v => new Date(v).getTime()).filter(Number.isFinite);
    const latest = (k) => { const t = times(k); return t.length ? new Date(Math.max(...t)).toISOString() : null; };
    const lastVerified = latest('last_reviewed_at');
    const disclaimerKey = ['dui', 'drugs', 'bail', 'sol'].includes(type) ? type : 'general';
    res.json({
      data: parsed,
      meta: {
        type,
        state: (state || 'ALL').toUpperCase(),
        count: parsed.length,
        disclaimer: msg(lang, `legaldata.disclaimer.${disclaimerKey}`),
        source_labels: [...new Set(parsed.map(r => r.source).filter(Boolean))],
        recorded_at: latest('created_at'),
        last_verified: lastVerified,
        reviewed: !!lastVerified,
        verified_only: VERIFIED_ONLY.has(type),
        withheld,
        not_legal_advice: true,
      },
    });
  } catch (e) {
    logger.error('[legaldata]', e.message);
    res.status(500).json({ error: 'server_error', code: 'server_error', message: msg(lang, 'legaldata.err.server') });
  }
});

export default router;
