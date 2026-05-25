/**
 * GET /api/legaldata/:type
 * Serves structured legal reference data by state.
 * Types: bail, dui, drugs, sol, federal-courts, victim-comp, clinics, bar-complaints
 */
import { err400, escapeLike, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import { Router } from "express";
import { getDb }   from "../db/index.js";
import { authRequired } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = Router();

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

router.get("/:type", authRequired, async (req, res) => {
  try {
    const { type } = req.params;
    const { state, q } = req.query;
    const qSafe = q ? escapeLike(String(q).trim(), 100) : null;
    const cfg = TABLE_MAP[type];
    if (!cfg) return res.status(404).json({ error: "Unknown data type" });

    const db = await getDb();
    // SELECT * is intentional here — each table in TABLE_MAP has a different schema.
    // The table name is constrained to TABLE_MAP keys (allowlist), never from user input.
    let sql = `SELECT * FROM ${cfg.table} WHERE 1=1 /* intentional: TABLE_MAP allowlist constrains table name */`;
    const params = [];

    if (state) {
      // Also include national records (state="ALL" or "FED") plus specific state
      sql += ` AND (${cfg.stateCol}=? OR ${cfg.stateCol}="ALL" OR ${cfg.stateCol}="FED")`;
      params.push(state.toUpperCase());
    }
    if (q) {
      const qParam = `%${qSafe}%`;
      sql += " AND (name LIKE ? OR charge LIKE ? OR notes LIKE ? OR district LIKE ?)";
      params.push(qParam, qParam, qParam, qParam);
    }
    sql += " ORDER BY id ASC LIMIT 500";

    const rows = await db.all(sql, params);

    // Parse JSON columns
    const parsed = rows.map(r => {
      if (r.covers) {
        try { r.covers = JSON.parse(r.covers); } catch {}
      }
      return r;
    });

    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");

    const DISCLAIMERS = {
      dui:    'DUI data sourced from NHTSA, IIHS, MADD, and state statutes. Last verified April 2026. Laws change frequently.',
      drugs:  'Drug penalty data from DEA scheduling and state criminal codes. Penalties vary by county, prior record, and judge. Last verified April 2026.',
      bail:   'Bail amounts are general ranges. Actual bail is set by a judge based on your specific circumstances.',
      sol:    'Statute of limitations data from published state criminal codes. Tolling rules and exceptions apply.',
    };
    const disclaimer = DISCLAIMERS[type] || 'General legal reference data. Not legal advice. Verify with a licensed attorney.';

    res.json({
      data: parsed,
      meta: {
        type,
        state: (state || 'ALL').toUpperCase(),
        count: parsed.length,
        disclaimer,
        last_verified: '2026-04-29',
        not_legal_advice: true,
      },
    });
  } catch (e) {
    logger.error('[legaldata]', e.message);
    res.status(500).json({ error: "Could not load legal data" });
  }
});

export default router;
