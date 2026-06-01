// Disclaimer appended to all signal outputs per legal policy
const SIGNAL_DISCLAIMER = 'AI-generated signals are informational only and do not constitute legal advice.';

/**
 * routes/firm_verticals.js — Vertical configuration, pricing tiers, and
 *                             specialty trackers for all 10 practice areas.
 *
 * GET    /api/firm-verticals/presets              — deadline presets by vertical (public)
 * GET    /api/firm-verticals/pricing              — pricing tier catalog (public)
 *
 * GET    /api/firm-verticals/mine                 — current firm's vertical config
 * PUT    /api/firm-verticals/mine                 — update vertical config (firm_admin)
 * POST   /api/firm-verticals/mine/mission-verify  — submit mission pricing request (firm_admin)
 *
 * GET    /api/firm-verticals/deadlines            — firm's active vertical deadlines
 *
 * ── Asylum clock (immigration) ────────────────────────────────────────────────
 * GET    /api/firm-verticals/asylum-clocks        — list asylum clocks (partner+)
 * POST   /api/firm-verticals/asylum-clocks        — create (associate+)
 * PATCH  /api/firm-verticals/asylum-clocks/:id    — update (associate+)
 * DELETE /api/firm-verticals/asylum-clocks/:id    — delete (partner+)
 *
 * EXTENUATING CIRCUMSTANCES TRACKERS:
 * GET/POST/PATCH /api/firm-verticals/plea-offers         — plea offer + Padilla tracking
 * GET/POST/PATCH /api/firm-verticals/voluntary-departure — voluntary departure deadline
 * GET/POST/PATCH /api/firm-verticals/vop                — VOP / probation violation
 * GET/POST/PATCH /api/firm-verticals/dv-firearms         — DV firearm surrender compliance
 * GET/POST/PATCH /api/firm-verticals/bop-exhaustion      — § 3582(c) BOP exhaustion
 * GET/POST/PATCH /api/firm-verticals/codefendants        — co-defendant links + JDA
 *
 * ── DPA tracker (white-collar) ───────────────────────────────────────────────
 * GET    /api/firm-verticals/dpa                  — list DPA trackers (partner+)
 * POST   /api/firm-verticals/dpa                  — create (associate+)
 * PATCH  /api/firm-verticals/dpa/:id              — update (associate+)
 * DELETE /api/firm-verticals/dpa/:id              — delete (partner+)
 *
 * ── TRO tracker (family law) ─────────────────────────────────────────────────
 * GET    /api/firm-verticals/tro                  — list TRO trackers (paralegal+)
 * POST   /api/firm-verticals/tro                  — create (paralegal+)
 * PATCH  /api/firm-verticals/tro/:id              — update (paralegal+)
 * DELETE /api/firm-verticals/tro/:id              — delete (partner+)
 *
 * ── Evidence + vulnerability (all verticals) ─────────────────────────────────
 * PATCH  /api/firm-verticals/matters/:id/scoring  — update evidence_score + vulnerability (associate+)
 */

import { Router }          from 'express';
import { authRequired }    from '../middleware/auth.js';
import { getDb }           from '../db/index.js';
import { hasMinRole }      from '../middleware/rbac.js';
import { writeAuditLog }   from '../middleware/audit.js';
import logger              from '../utils/logger.js';
import {
  err400, err403, err404, safeInt,
  sanitizeStr, truncateStr,
}                          from '../utils/routeHelpers.js';
import { makeUserLimiter }   from '../middleware/sharedAiLimiter.js';

const routeLimiter = makeUserLimiter(30, 60_000); // 30 req/min per user

const router = Router();

// ─── VERTICAL CONSTANTS ───────────────────────────────────────────────────────
const VALID_VERTICALS = [
  'criminal_defense','civil_rights','white_collar','family','immigration',
  'personal_injury','public_defense','appellate','military','juvenile','general',
];

// ISO date validator
const ISO_DATE_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
function isValidDate(s) { return typeof s === 'string' && ISO_DATE_RE.test(s); }

// URL validator — must start with http:// or https://
const URL_RE = /^https?:\/\//i;

// EIN validator (US format XX-XXXXXXX)
const EIN_RE = /^\d{2}-\d{7}$/;
function isValidEIN(s) { return typeof s === 'string' && EIN_RE.test(s.trim()); }

// VAR-C / VAR-D constants (mirrors simulation)
const VALID_VULNERABILITY = ['low','moderate','high','crisis'];
const VALID_TIME_PRESSURE = ['emergency','standard','relaxed'];
const VALID_RELIEF = [
  'asylum','cancellation','DACA','VAWA','U_visa',
  'withholding','CAT','adjustment','citizenship','humanitarian','TPS','SIJ',
];
// Country condition values — mirror computeImmigrationSignals country_condition buckets
const VALID_COUNTRY = ['crisis','deteriorating','stable','improving','unknown'];
const VALID_ASSET = ['under_100k','100k_500k','500k_2m','2m_10m','over_10m'];
const VALID_ORG   = ['nonprofit','public_defender','government','legal_aid'];

/** Maps 0-100 evidence score to bucket label.
 * Mirrors evidenceBucket in matter_intelligence.js — keep in sync.
 * Clamps to [0, 100] to match matter_intelligence.js behavior. */
function evidenceBucket(score) {
  const s = Math.max(0, Math.min(100, safeInt(score, 50)));
  if (s < 25) return 'weak';
  if (s < 50) return 'contested';
  if (s < 75) return 'moderate';
  return 'strong';
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * Verify matter_id belongs to the firm before linking a tracker.
 * Returns true if validation FAILED (response already sent).
 * Returns false if valid (caller should proceed).
 *
 * Usage: if (await validateMatterId(db, matter_id, memb.firm_id, res)) return;
 */
async function validateMatterId(db, matterId, firmId, res) {
  if (!matterId) return false; // optional field — no matter_id is always valid
  // Fast guard: non-numeric matter_id can never exist — skip DB round-trip
  const mid = parseInt(matterId, 10);
  if (isNaN(mid) || mid <= 0) { err400(res, `Invalid matter_id: ${matterId}.`); return true; }

  const m = await db.get(
    'SELECT id, firm_id FROM matters WHERE id=?',
    [mid]
  ).catch(() => null);
  if (!m) { err404(res, `Matter ${matterId} not found.`); return true; }
  if (m.firm_id && m.firm_id !== firmId) { err403(res, 'Matter does not belong to your firm.'); return true; }
  return false; // valid — caller proceeds
}

async function getFirmMembership(db, userId) {
  return db.get(
    `SELECT fm.firm_id, fm.firm_role as role, f.vertical, f.pricing_tier,
            f.mission_verified
     FROM firm_members fm
     JOIN firms f ON f.id = fm.firm_id
     WHERE fm.user_id=? AND fm.status='active' LIMIT 1`,
    [userId]
  ).catch(() => null);
}

// NOTE: dateStr must be YYYY-MM-DD format only. Full ISO strings (with time component)
// would produce Invalid Date. All callers are guarded by isValidDate() upstream.
function addCalendarDays(dateStr, days) {
  if (days === 0) return dateStr; // 0 days → same date
  // Negative days intentionally supported for history/lookback date calculations
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addBusinessDays(dateStr, days) {
  if (days <= 0) return dateStr; // guard: 0 or negative returns same date
  const d = new Date(dateStr + 'T12:00:00Z');
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

// ─── PUBLIC ENDPOINTS ─────────────────────────────────────────────────────────

// GET /api/firm-verticals/presets — deadline presets by vertical
router.get('/presets', async (req, res) => {
  try {
    const db     = await getDb();
    const { vertical } = req.query;
    let rows;
    if (vertical) {
      const v = sanitizeStr(vertical, 50);
      if (!VALID_VERTICALS.includes(v)) return err400(res, `Invalid vertical. Options: ${VALID_VERTICALS.join(', ')}`);
      rows = await db.all(
        'SELECT rule_key, label, days, business_days, priority, description, vertical FROM vertical_deadline_presets WHERE vertical=? ORDER BY days ASC',
        [v]
      );
    } else {
      rows = await db.all('SELECT rule_key, label, days, business_days, priority, description, vertical FROM vertical_deadline_presets ORDER BY vertical, days ASC');
    }
    res.set('Cache-Control', 'public, max-age=86400');  // presets are static, cache 24h
    res.json({ presets: rows, total: rows.length });
  } catch (e) {
    logger.error('[firm-verticals/presets]', e.message);
    res.status(500).json({ error: 'Could not load presets.' });
  }
});

// GET /api/firm-verticals/pricing — pricing tier catalog
router.get('/pricing', async (req, res) => {
  try {
    const db   = await getDb();
    const rows = await db.all(
      `SELECT tier_key, display_name, monthly_cents, annual_cents,
              seat_limit, matter_limit, ai_calls_daily, description
       FROM firm_pricing_configs WHERE active=1 ORDER BY monthly_cents ASC`
    );
    res.set('Cache-Control', 'public, max-age=3600');  // pricing changes at most hourly
    res.json({ tiers: rows });
  } catch (e) {
    logger.error('[firm-verticals/pricing]', e.message);
    res.status(500).json({ error: 'Could not load pricing.' });
  }
});

// ─── FIRM-SCOPED ENDPOINTS (authRequired) ─────────────────────────────────────

// GET /api/firm-verticals/mine
router.get('/mine', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return res.json({ config: null, message: 'Not a member of any firm.' });

    const config = await db.get(
      `SELECT firm_id, vertical,
        bail_calc_enabled, expunge_pipeline, class_action_track, sol_calendar,
        dpa_tracker, coop_credit_model, tro_alerts, qdro_matching,
        asylum_clock, detention_alerts, expert_matching, damages_model,
        caseload_dashboard, diversion_tracker, aedpa_tracker, capital_flag,
        ucmj_taxonomy, clearance_workflow, juvenile_expunge, transfer_monitor,
        created_at, updated_at
       FROM firm_vertical_config WHERE firm_id=?`,
      [memb.firm_id]
    );
    const firm = await db.get(
      'SELECT id, name, vertical, pricing_tier, mission_verified, seat_limit FROM firms WHERE id=?',
      [memb.firm_id]
    );

    if (!firm) return err404(res, 'Firm not found.');
    res.json({
      firm,
      config: config || {
        firm_id: memb.firm_id,
        vertical: firm.vertical || null,
        bail_calc_enabled: 0, expunge_pipeline: 0, class_action_track: 0,
        sol_calendar: 0, dpa_tracker: 0, coop_credit_model: 0, tro_alerts: 0,
        qdro_matching: 0, asylum_clock: 0, detention_alerts: 0,
        expert_matching: 0, damages_model: 0, caseload_dashboard: 0,
        diversion_tracker: 0, aedpa_tracker: 0, capital_flag: 0,
        ucmj_taxonomy: 0, clearance_workflow: 0, juvenile_expunge: 0,
        transfer_monitor: 0, created_at: null, updated_at: null,
        _unconfigured: true   // FE can show "Set up your vertical" prompt
      },
      your_role: memb.role
    });
  } catch (e) {
    logger.error('[firm-verticals/mine GET]', e.message);
    res.status(500).json({ error: 'Could not load vertical config.' });
  }
});

// PUT /api/firm-verticals/mine
router.put('/mine', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb)                              return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'firm_admin')) return err403(res, 'Requires firm_admin.');

    const {
      vertical,
      bail_calc_enabled, expunge_pipeline,
      class_action_track, sol_calendar,
      dpa_tracker, coop_credit_model,
      tro_alerts, qdro_matching,
      asylum_clock, detention_alerts,
      expert_matching, damages_model,
      caseload_dashboard, diversion_tracker,
      aedpa_tracker, capital_flag,
      ucmj_taxonomy, clearance_workflow,
      juvenile_expunge, transfer_monitor,
    } = req.body || {};

    if (vertical && !VALID_VERTICALS.includes(vertical)) {
      return err400(res, `Invalid vertical. Options: ${VALID_VERTICALS.join(', ')}`);
    }

    const now = new Date().toISOString();

    // Read ALL flag columns from existing config so boolField() can fall back
    // to current values for any flag not included in this PUT request.
    // SELECT * is intentional here — we need every feature flag column.
    const existing = await db.get(
      'SELECT * FROM firm_vertical_config WHERE firm_id=?', [memb.firm_id]  /* full record needed for boolField fallback */
    ).catch(() => null);

    // boolField: explicit true/false/1/0 overrides; undefined falls back to existing value
    const boolField = (v, key) => {
      if (v === true  || v === 1 || v === '1') return 1;
      if (v === false || v === 0 || v === '0') return 0;
      // v is undefined — preserve existing
      return existing?.[key] ?? 0;
    };

    // Update firm vertical if provided
    if (vertical) {
      await db.run('UPDATE firms SET vertical=?, updated_at=? WHERE id=?', [vertical, now, memb.firm_id]);
    }

    // Upsert vertical config
    await db.run(`
      INSERT INTO firm_vertical_config
        (firm_id, vertical,
         bail_calc_enabled, expunge_pipeline, class_action_track, sol_calendar,
         dpa_tracker, coop_credit_model, tro_alerts, qdro_matching,
         asylum_clock, detention_alerts, expert_matching, damages_model,
         caseload_dashboard, diversion_tracker, aedpa_tracker, capital_flag,
         ucmj_taxonomy, clearance_workflow, juvenile_expunge, transfer_monitor,
         updated_at)
      VALUES (?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?, ?)
      ON CONFLICT(firm_id) DO UPDATE SET
        vertical=excluded.vertical,
        bail_calc_enabled=excluded.bail_calc_enabled,
        expunge_pipeline=excluded.expunge_pipeline,
        class_action_track=excluded.class_action_track,
        sol_calendar=excluded.sol_calendar,
        dpa_tracker=excluded.dpa_tracker,
        coop_credit_model=excluded.coop_credit_model,
        tro_alerts=excluded.tro_alerts,
        qdro_matching=excluded.qdro_matching,
        asylum_clock=excluded.asylum_clock,
        detention_alerts=excluded.detention_alerts,
        expert_matching=excluded.expert_matching,
        damages_model=excluded.damages_model,
        caseload_dashboard=excluded.caseload_dashboard,
        diversion_tracker=excluded.diversion_tracker,
        aedpa_tracker=excluded.aedpa_tracker,
        capital_flag=excluded.capital_flag,
        ucmj_taxonomy=excluded.ucmj_taxonomy,
        clearance_workflow=excluded.clearance_workflow,
        juvenile_expunge=excluded.juvenile_expunge,
        transfer_monitor=excluded.transfer_monitor,
        updated_at=excluded.updated_at
    `, [
      memb.firm_id, vertical || memb.vertical,
      boolField(bail_calc_enabled, 'bail_calc_enabled'), boolField(expunge_pipeline, 'expunge_pipeline'),
      boolField(class_action_track, 'class_action_track'), boolField(sol_calendar, 'sol_calendar'),
      boolField(dpa_tracker, 'dpa_tracker'), boolField(coop_credit_model, 'coop_credit_model'),
      boolField(tro_alerts, 'tro_alerts'), boolField(qdro_matching, 'qdro_matching'),
      boolField(asylum_clock, 'asylum_clock'), boolField(detention_alerts, 'detention_alerts'),
      boolField(expert_matching, 'expert_matching'), boolField(damages_model, 'damages_model'),
      boolField(caseload_dashboard, 'caseload_dashboard'), boolField(diversion_tracker, 'diversion_tracker'),
      boolField(aedpa_tracker, 'aedpa_tracker'), boolField(capital_flag, 'capital_flag'),
      boolField(ucmj_taxonomy, 'ucmj_taxonomy'), boolField(clearance_workflow, 'clearance_workflow'),
      boolField(juvenile_expunge, 'juvenile_expunge'), boolField(transfer_monitor, 'transfer_monitor'),
      now,
    ]);

    await writeAuditLog(db, {
      user_id: req.user.id, firm_id: memb.firm_id,
      action: 'update', resource: 'firm_vertical_config',
      record_id: memb.firm_id,
      new_value: {
        vertical: vertical || memb.vertical,
        features: Object.fromEntries(
          Object.entries({ bail_calc_enabled, expunge_pipeline, class_action_track, sol_calendar,
            dpa_tracker, coop_credit_model, tro_alerts, qdro_matching, asylum_clock,
            detention_alerts, expert_matching, damages_model, caseload_dashboard,
            diversion_tracker, aedpa_tracker, capital_flag, ucmj_taxonomy,
            clearance_workflow, juvenile_expunge, transfer_monitor })
          .map(([k, v]) => [k, boolField(v, k)])
        ),
      },
      ip: req.ip, ua: req.headers['user-agent'],
    });

    const config = await db.get(
      `SELECT firm_id, vertical,
        bail_calc_enabled, expunge_pipeline, class_action_track, sol_calendar,
        dpa_tracker, coop_credit_model, tro_alerts, qdro_matching,
        asylum_clock, detention_alerts, expert_matching, damages_model,
        caseload_dashboard, diversion_tracker, aedpa_tracker, capital_flag,
        ucmj_taxonomy, clearance_workflow, juvenile_expunge, transfer_monitor,
        created_at, updated_at
       FROM firm_vertical_config WHERE firm_id=?`,
      [memb.firm_id]
    );
    res.json({ updated: true, config: config || { firm_id: memb.firm_id, updated_at: new Date().toISOString() } });
  } catch (e) {
    logger.error('[firm-verticals/mine PUT]', e.message);
    res.status(500).json({ error: 'Could not update vertical config.' });
  }
});

// POST /api/firm-verticals/mine/mission-verify
router.post('/mine/mission-verify', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb)                              return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'firm_admin')) return err403(res, 'Requires firm_admin.');

    const { org_type, ein, website, documentation } = req.body || {};
    if (!org_type) return err400(res, 'org_type is required.');
    if (!VALID_ORG.includes(org_type)) return err400(res, `org_type must be one of: ${VALID_ORG.join(', ')}`);
    if (ein && !isValidEIN(ein)) return err400(res, 'EIN must be in format XX-XXXXXXX (e.g. 12-3456789).');
    if (website && !URL_RE.test(website)) return err400(res, 'website must start with http:// or https://');
    if (website && website.length > 500) return err400(res, 'website must be 500 characters or fewer.');

    // Reject if firm is already mission_verified
    if (memb.mission_verified) {
      return res.status(409).json({ error: 'This firm is already verified for mission pricing.', code: 'ALREADY_VERIFIED' });
    }

    // One pending request per firm
    const existing = await db.get(
      "SELECT id FROM mission_verification_requests WHERE firm_id=? AND status='pending'",
      [memb.firm_id]
    );
    if (existing) {
      return res.status(409).json({ error: 'A pending verification request already exists for this firm.', id: existing.id });
    }

    const r = await db.run(
      `INSERT INTO mission_verification_requests (firm_id, submitted_by, org_type, ein, website, documentation)
       VALUES (?,?,?,?,?,?)`,
      [memb.firm_id, req.user.id, org_type,
       ein ? sanitizeStr(ein, 20) : null,
       website ? sanitizeStr(truncateStr(website, 500), 500) : null,
       documentation ? sanitizeStr(truncateStr(documentation, 1000), 1000) : null]
    );

    await writeAuditLog(db, {
      user_id: req.user.id, firm_id: memb.firm_id,
      action: 'create', resource: 'mission_verification',
      record_id: r.lastID,
      new_value: { org_type, ein },
      ip: req.ip, ua: req.headers['user-agent'],
    });

    res.status(201).json({
      submitted: true,
      id: r.lastID,
      message: 'Mission pricing verification request submitted. Review typically takes 1-3 business days.',
    });
  } catch (e) {
    logger.error('[firm-verticals/mission-verify]', e.message);
    res.status(500).json({ error: 'Could not submit verification request.' });
  }
});

// GET /api/firm-verticals/deadlines — compute live deadlines for firm's vertical
router.get('/deadlines', authRequired, async (req, res) => {
  try {
    const db     = await getDb();
    const memb   = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');

    const { trigger_date } = req.query;
    if (trigger_date && !isValidDate(trigger_date)) {
      return err400(res, 'trigger_date must be a valid ISO date (YYYY-MM-DD).');
    }
    const triggerDate = (trigger_date && isValidDate(trigger_date))
      ? trigger_date
      : new Date().toISOString().slice(0, 10);

    const presets = await db.all(
      'SELECT rule_key, label, days, business_days, priority, description, vertical FROM vertical_deadline_presets WHERE vertical=? ORDER BY days ASC',
      [memb.vertical || 'general']
    );

    const deadlines = presets.map(p => ({
      rule_key:      p.rule_key,
      label:         p.label,
      due:           p.business_days
        ? addBusinessDays(triggerDate, p.days)
        : addCalendarDays(triggerDate, p.days),
      days:          p.days,
      business_days: !!p.business_days,
      priority:      p.priority,
      description:   p.description,
    })).sort((a, b) => a.due.localeCompare(b.due));

    res.json({
      vertical: memb.vertical || 'general',
      trigger_date: triggerDate,
      deadlines,
      total: deadlines.length,
    });
  } catch (e) {
    logger.error('[firm-verticals/deadlines]', e.message);
    res.status(500).json({ error: 'Could not compute deadlines.' });
  }
});

// ─── ASYLUM CLOCK ENDPOINTS ───────────────────────────────────────────────────

router.get('/asylum-clocks', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'partner')) return err403(res, 'Requires partner+.');

    const limit  = Math.min(safeInt(req.query.limit, 100), 500);
    const offset = safeInt(req.query.offset, 0);
    const rows = await db.all(
      'SELECT id, firm_id, matter_id, client_name, a_number, clock_start, relief_type, country, detained, paused_days, clock_paused, notes, created_at, updated_at FROM asylum_clocks WHERE firm_id=? ORDER BY clock_start ASC LIMIT ? OFFSET ?',
      [memb.firm_id, limit, offset]
    );
    const { total_count } = await db.get(
      'SELECT COUNT(*) as total_count FROM asylum_clocks WHERE firm_id=?', [memb.firm_id]
    ).catch(() => ({ total_count: rows.length }));

    const today = new Date().toISOString().slice(0, 10);
    const enriched = rows.map(r => {
      const start   = new Date(r.clock_start + 'T12:00:00Z');
      const now     = new Date(today + 'T12:00:00Z');
      const rawElapsed = Math.ceil((now - start) / 86400000) - (r.paused_days || 0);
      const elapsed    = Math.max(0, rawElapsed);  // clamp — future clock_start produces negative otherwise
      const barred          = elapsed > 365 && r.relief_type === 'asylum';
      // approaching_bar: attorney warning zone — 300-365 days (not yet barred, but urgent)
      // Display threshold: >=290 elapsed days (75-day warning window).
      // Wider than signal engine's asylumBarRisk (>300 stored clock_days) — intentional.
      // Display uses computed elapsed_days; signal engine reads stored DB clock_days.
      const approaching_bar = elapsed >= 290 && elapsed <= 365 && r.relief_type === 'asylum';
      return {
        ...r,
        elapsed_days:    elapsed,
        one_year_barred: barred,
        approaching_bar,
        days_until_bar:  Math.max(0, 365 - elapsed),
      };
    });

    res.json({ clocks: enriched, total: total_count, returned: enriched.length, limit, offset, firm_id: memb.firm_id });
  } catch (e) {
    logger.error('[asylum-clocks GET]', e.message);
    res.status(500).json({ error: 'Could not load asylum clocks.' });
  }
});

router.post('/asylum-clocks', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const { client_name, clock_start, relief_type = 'asylum', country, detained = 0, a_number, matter_id, notes } = req.body || {};
    if (!client_name?.trim()) return err400(res, 'client_name is required.');
    if (!clock_start)         return err400(res, 'clock_start (ISO date) is required.');
    if (!isValidDate(clock_start)) return err400(res, 'clock_start must be a valid ISO date (YYYY-MM-DD).');
    if (relief_type && !VALID_RELIEF.includes(relief_type)) {
      return err400(res, `relief_type must be one of: ${VALID_RELIEF.join(', ')}`);
    }
    if (country && !VALID_COUNTRY.includes(country)) {
      return err400(res, `country must be one of: ${VALID_COUNTRY.join(', ')}`);
    }

    const matterErr = await validateMatterId(db, matter_id, memb.firm_id, res);
    if (matterErr) return;

    const r = await db.run(
      `INSERT INTO asylum_clocks (firm_id, matter_id, client_name, a_number, clock_start, relief_type, country, detained, notes)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [memb.firm_id, matter_id ? safeInt(matter_id) : null,
       sanitizeStr(truncateStr(client_name.trim(), 200), 200),
       a_number ? sanitizeStr(a_number, 20) : null,
       clock_start,
       sanitizeStr(relief_type, 50),
       country ? sanitizeStr(country, 100) : null,
       detained ? 1 : 0,
       notes ? sanitizeStr(truncateStr(notes, 1000), 1000) : null]
    );

    res.status(201).json({ created: true, id: r.lastID, client_name: client_name.trim() });
  } catch (e) {
    logger.error('[asylum-clocks POST]', e.message);
    res.status(500).json({ error: 'Could not create asylum clock.' });
  }
});

router.patch('/asylum-clocks/:id', authRequired, routeLimiter, async (req, res) => {
  try {
    const db     = await getDb();
    const memb   = await getFirmMembership(db, req.user.id);
    const clockId = safeInt(req.params.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const row = await db.get('SELECT id, firm_id, matter_id, client_name, a_number, clock_start, relief_type, country, detained, paused_days, clock_paused, notes, created_at, updated_at FROM asylum_clocks WHERE id=? AND firm_id=?', [clockId, memb.firm_id]);
    if (!row) return err404(res, 'Asylum clock not found.');

    const { clock_paused, paused_days, detained, country, notes, relief_type } = req.body || {};
    const updates = [], params = [];
    if (clock_paused !== undefined) { updates.push('clock_paused=?'); params.push(clock_paused ? 1 : 0); }
    if (paused_days  !== undefined) { updates.push('paused_days=?');  params.push(Math.max(0, safeInt(paused_days, 0))); }
    if (detained     !== undefined) { updates.push('detained=?');     params.push(detained ? 1 : 0); }
    if (country !== undefined) {
      if (country && !VALID_COUNTRY.includes(country)) return err400(res, `country must be one of: ${VALID_COUNTRY.join(', ')}`);
      updates.push('country=?'); params.push(country ? sanitizeStr(country, 50) : null);
    }
    // notes: undefined=no-change, empty-string=clear, non-empty=update
    if (notes !== undefined)        { updates.push('notes=?');        params.push(notes ? sanitizeStr(truncateStr(notes, 1000), 1000) : null); }
    if (relief_type !== undefined) {
      if (relief_type && !VALID_RELIEF.includes(relief_type)) return err400(res, `relief_type must be one of: ${VALID_RELIEF.join(', ')}`);
      if (!relief_type) return err400(res, 'relief_type cannot be empty. To keep current value, omit the field.');
      updates.push('relief_type=?'); params.push(sanitizeStr(relief_type, 50));
    }
    if (!updates.length) return err400(res, 'No fields to update.');

    updates.push('updated_at=?'); params.push(new Date().toISOString());
    params.push(clockId);
    await db.run(`UPDATE asylum_clocks SET ${updates.join(',')} WHERE id=?`, params);

    const updated = await db.get('SELECT id, firm_id, matter_id, client_name, a_number, clock_start, relief_type, country, detained, paused_days, clock_paused, notes, created_at, updated_at FROM asylum_clocks WHERE id=?', [clockId]);
    res.json({ updated: true, clock: updated || { id: clockId, updated_at: new Date().toISOString() } });
  } catch (e) {
    logger.error('[asylum-clocks PATCH]', e.message);
    res.status(500).json({ error: 'Could not update asylum clock.' });
  }
});

router.delete('/asylum-clocks/:id', authRequired, async (req, res) => {
  try {
    const db     = await getDb();
    const memb   = await getFirmMembership(db, req.user.id);
    const clockId = safeInt(req.params.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'partner')) return err403(res, 'Requires partner+.');

    const row = await db.get('SELECT id FROM asylum_clocks WHERE id=? AND firm_id=?', [clockId, memb.firm_id]);
    if (!row) return err404(res, 'Asylum clock not found.');

    await db.run('DELETE FROM asylum_clocks WHERE id=?', [clockId]);
    res.json({ deleted: true, id: clockId });
  } catch (e) {
    logger.error('[asylum-clocks DELETE]', e.message);
    res.status(500).json({ error: 'Could not delete asylum clock.' });
  }
});

// ─── DPA TRACKER ENDPOINTS ────────────────────────────────────────────────────

const VALID_COOP   = ['full_cooperation','limited_cooperation','no_cooperation','proffer_agreement','unknown'];
const VALID_DPA    = ['evaluating','viable','negotiating','signed','declined','npa_signed'];
const COOP_DISCOUNTS = { full_cooperation:0.30, limited_cooperation:0.15, proffer_agreement:0.20, no_cooperation:0, unknown:0 };

router.get('/dpa', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'partner')) return err403(res, 'Requires partner+.');

    const limit  = Math.min(safeInt(req.query.limit, 100), 500);
    const offset = safeInt(req.query.offset, 0);
    const rows = await db.all(
      'SELECT id, firm_id, matter_id, client_name, agency, investigation_type, cooperation_level, dpa_status, base_fine_cents, coop_discount_pct, dpa_credit_pct, effective_fine_cents, wells_due, subpoena_due, dpa_sign_due, notes, created_at, updated_at FROM dpa_trackers WHERE firm_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [memb.firm_id, limit, offset]
    );
    const { total_count } = await db.get(
      'SELECT COUNT(*) as total_count FROM dpa_trackers WHERE firm_id=?', [memb.firm_id]
    ).catch(() => ({ total_count: rows.length }));
    // Enrich with computed deadline urgency
    const nowMs = Date.now();
    const enriched = rows.map(r => {
      const wellsMs = r.wells_due    ? new Date(r.wells_due).getTime()    : null;
      const subMs   = r.subpoena_due ? new Date(r.subpoena_due).getTime() : null;
      const signMs  = r.dpa_sign_due ? new Date(r.dpa_sign_due).getTime() : null;
      return {
        ...r,
        days_until_wells:    wellsMs ? Math.ceil((wellsMs - nowMs) / 86400000) : null,
        wells_overdue:       wellsMs ? wellsMs < nowMs : false,
        days_until_subpoena: subMs   ? Math.ceil((subMs  - nowMs) / 86400000) : null,
        subpoena_overdue:    subMs   ? subMs < nowMs : false,
        days_until_sign:     signMs  ? Math.ceil((signMs - nowMs) / 86400000) : null,
        sign_overdue:        signMs  ? signMs < nowMs : false,
      };
    });
    res.json({ trackers: enriched, total: total_count, returned: enriched.length, limit, offset });
  } catch (e) {
    logger.error('[dpa GET]', e.message);
    res.status(500).json({ error: 'Could not load DPA trackers.' });
  }
});

router.post('/dpa', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const {
      client_name, agency, investigation_type,
      cooperation_level = 'unknown', dpa_status = 'evaluating',
      base_fine_cents = 0, matter_id, notes,
      wells_due, subpoena_due, dpa_sign_due,
    } = req.body || {};
    if (!client_name?.trim()) return err400(res, 'client_name is required.');
    if (cooperation_level && !VALID_COOP.includes(cooperation_level)) return err400(res, 'Invalid cooperation_level.');
    if (dpa_status && !VALID_DPA.includes(dpa_status)) return err400(res, 'Invalid dpa_status.');
    if (wells_due && !isValidDate(wells_due)) return err400(res, 'wells_due must be YYYY-MM-DD.');
    if (subpoena_due && !isValidDate(subpoena_due)) return err400(res, 'subpoena_due must be YYYY-MM-DD.');

    const disc       = COOP_DISCOUNTS[cooperation_level] || 0;
    const adjFine    = Math.round(safeInt(base_fine_cents, 0) * (1 - disc));
    const dpaCredit  = ['viable','negotiating','signed'].includes(dpa_status);
    const effFine    = dpaCredit ? Math.round(adjFine * 0.7) : adjFine;

    const matterErr = await validateMatterId(db, matter_id, memb.firm_id, res);
    if (matterErr) return;

    const r = await db.run(
      `INSERT INTO dpa_trackers
         (firm_id, matter_id, client_name, agency, investigation_type,
          cooperation_level, dpa_status, base_fine_cents, coop_discount_pct,
          dpa_credit_pct, effective_fine_cents, wells_due, subpoena_due, dpa_sign_due, notes)
       VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?)`,
      [memb.firm_id, matter_id ? safeInt(matter_id) : null,
       sanitizeStr(truncateStr(client_name.trim(), 200), 200),
       agency ? sanitizeStr(agency, 100) : null,
       investigation_type ? sanitizeStr(investigation_type, 200) : null,
       cooperation_level, dpa_status, safeInt(base_fine_cents, 0), disc,
       dpaCredit ? 0.30 : 0, effFine,
       wells_due || null, subpoena_due || null,
       dpa_sign_due || null,
       notes ? sanitizeStr(truncateStr(notes, 2000), 2000) : null]
    );

    res.status(201).json({ created: true, id: r.lastID, effective_fine_cents: effFine });
  } catch (e) {
    logger.error('[dpa POST]', e.message);
    res.status(500).json({ error: 'Could not create DPA tracker.' });
  }
});

router.patch('/dpa/:id', authRequired, routeLimiter, async (req, res) => {
  try {
    const db    = await getDb();
    const memb  = await getFirmMembership(db, req.user.id);
    const dpaId = safeInt(req.params.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const row = await db.get('SELECT id, firm_id, matter_id, client_name, agency, investigation_type, cooperation_level, dpa_status, base_fine_cents, coop_discount_pct, dpa_credit_pct, effective_fine_cents, wells_due, subpoena_due, dpa_sign_due, notes, created_at, updated_at FROM dpa_trackers WHERE id=? AND firm_id=?', [dpaId, memb.firm_id]);
    if (!row) return err404(res, 'DPA tracker not found.');

    const { cooperation_level, dpa_status, base_fine_cents, wells_due, subpoena_due, dpa_sign_due, notes } = req.body || {};
    if (cooperation_level && !VALID_COOP.includes(cooperation_level)) return err400(res, 'Invalid cooperation_level.');
    if (dpa_status && !VALID_DPA.includes(dpa_status)) return err400(res, 'Invalid dpa_status.');
    if (wells_due    && !isValidDate(wells_due))    return err400(res, 'wells_due must be YYYY-MM-DD.');
    if (subpoena_due && !isValidDate(subpoena_due)) return err400(res, 'subpoena_due must be YYYY-MM-DD.');
    if (dpa_sign_due && !isValidDate(dpa_sign_due)) return err400(res, 'dpa_sign_due must be YYYY-MM-DD.');

    const newCoop  = cooperation_level || row.cooperation_level;
    const newDpa   = dpa_status || row.dpa_status;
    const newBase  = base_fine_cents !== undefined ? Math.max(0, safeInt(base_fine_cents, 0)) : row.base_fine_cents;
    const disc     = COOP_DISCOUNTS[newCoop] || 0;
    const adjFine  = Math.round(newBase * (1 - disc));
    const dpaCredit= ['viable','negotiating','signed'].includes(newDpa);
    const effFine  = dpaCredit ? Math.round(adjFine * 0.7) : adjFine;

    await db.run(
      `UPDATE dpa_trackers SET
         cooperation_level=?, dpa_status=?, base_fine_cents=?,
         coop_discount_pct=?, dpa_credit_pct=?, effective_fine_cents=?,
         wells_due=?, subpoena_due=?, dpa_sign_due=?,
         notes=?, updated_at=?
       WHERE id=?`,
      [newCoop, newDpa, newBase, disc, dpaCredit ? 0.30 : 0, effFine,
       wells_due    !== undefined ? (wells_due    || null) : row.wells_due,
       subpoena_due !== undefined ? (subpoena_due || null) : row.subpoena_due,
       dpa_sign_due !== undefined ? (dpa_sign_due || null) : row.dpa_sign_due,
       notes !== undefined ? (notes ? sanitizeStr(truncateStr(notes, 2000), 2000) : null) : row.notes,
       new Date().toISOString(), dpaId]
    );

    const updated = await db.get('SELECT id, firm_id, matter_id, client_name, agency, investigation_type, cooperation_level, dpa_status, base_fine_cents, coop_discount_pct, dpa_credit_pct, effective_fine_cents, wells_due, subpoena_due, dpa_sign_due, notes, created_at, updated_at FROM dpa_trackers WHERE id=?', [dpaId]);
    res.json({ updated: true, tracker: updated || { id: dpaId, updated_at: new Date().toISOString() } });
  } catch (e) {
    logger.error('[dpa PATCH]', e.message);
    res.status(500).json({ error: 'Could not update DPA tracker.' });
  }
});

router.delete('/dpa/:id', authRequired, async (req, res) => {
  try {
    const db    = await getDb();
    const memb  = await getFirmMembership(db, req.user.id);
    const dpaId = safeInt(req.params.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'partner')) return err403(res, 'Requires partner+.');
    const row = await db.get('SELECT id FROM dpa_trackers WHERE id=? AND firm_id=?', [dpaId, memb.firm_id]);
    if (!row) return err404(res, 'DPA tracker not found.');
    await db.run('DELETE FROM dpa_trackers WHERE id=?', [dpaId]);
    res.json({ deleted: true, id: dpaId });
  } catch (e) {
    logger.error('[dpa DELETE]', e.message);
    res.status(500).json({ error: 'Could not delete DPA tracker.' });
  }
});

// ─── TRO TRACKER ENDPOINTS ────────────────────────────────────────────────────

router.get('/tro', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'paralegal')) return err403(res, 'Requires paralegal+.');

    const limit  = Math.min(safeInt(req.query.limit, 100), 500);
    const offset = safeInt(req.query.offset, 0);
    const rows = await db.all(
      'SELECT id, firm_id, matter_id, client_name, dv_flag, tro_filed, tro_hearing_due, protective_order_due, tro_granted, tro_served, asset_tier, notes, created_at, updated_at FROM tro_trackers WHERE firm_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [memb.firm_id, limit, offset]
    );
    const { total_count } = await db.get(
      'SELECT COUNT(*) as total_count FROM tro_trackers WHERE firm_id=?', [memb.firm_id]
    ).catch(() => ({ total_count: rows.length }));
    // Enrich with computed time fields — mirrors asylum clock enrichment pattern
    const nowMs = Date.now();
    const enriched = rows.map(r => {
      const hearingMs = r.tro_hearing_due      ? new Date(r.tro_hearing_due).getTime()      : null;
      const poMs      = r.protective_order_due ? new Date(r.protective_order_due).getTime() : null;
      return {
        ...r,
        days_until_hearing: hearingMs ? Math.ceil((hearingMs - nowMs) / 86400000) : null,
        hearing_overdue:    hearingMs ? hearingMs < nowMs : false,
        days_until_po:      poMs      ? Math.ceil((poMs - nowMs) / 86400000)      : null,
        po_overdue:         poMs      ? poMs < nowMs : false,
      };
    });
    res.json({ trackers: enriched, total: total_count, returned: enriched.length, limit, offset });
  } catch (e) {
    logger.error('[tro GET]', e.message);
    res.status(500).json({ error: 'Could not load TRO trackers.' });
  }
});

router.post('/tro', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'paralegal')) return err403(res, 'Requires paralegal+.');

    // dv_flag: JSON boolean/integer only (express.json() guarantees no string coercion)
    // 0/false/null/undefined → no DV flag; 1/true → DV flag set
    const { client_name, dv_flag = 0, tro_filed, asset_tier = 'under_100k', matter_id, notes } = req.body || {};
    const dvFlagBool = dv_flag === true || dv_flag === 1;  // normalize to boolean
    if (!client_name?.trim()) return err400(res, 'client_name is required.');

    if (asset_tier && !VALID_ASSET.includes(asset_tier)) return err400(res, 'Invalid asset_tier.');

    if (tro_filed && !isValidDate(tro_filed)) return err400(res, 'tro_filed must be a valid ISO date (YYYY-MM-DD).');
    const filedDate   = (tro_filed && isValidDate(tro_filed)) ? tro_filed : new Date().toISOString().slice(0, 10);
    // 3 business days is a common emergency TRO hearing default.
    // This VARIES BY JURISDICTION — CA: 21 days, other states 7-14 days.
    // Attorneys must verify the applicable local court rule.
    const hearingDue  = dvFlagBool ? addBusinessDays(filedDate, 3) : null;
    const poDate      = dvFlagBool ? addCalendarDays(filedDate, 21) : null;

    const matterErr = await validateMatterId(db, matter_id, memb.firm_id, res);
    if (matterErr) return;

    const r = await db.run(
      `INSERT INTO tro_trackers
         (firm_id, matter_id, client_name, dv_flag, tro_filed, tro_hearing_due, protective_order_due, asset_tier, notes)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [memb.firm_id, matter_id ? safeInt(matter_id) : null,
       sanitizeStr(truncateStr(client_name.trim(), 200), 200),
       dvFlagBool ? 1 : 0, filedDate, hearingDue, poDate,
       asset_tier,
       notes ? sanitizeStr(truncateStr(notes, 1000), 1000) : null]
    );

    res.status(201).json({
      created: true, id: r.lastID,
      client_name: client_name.trim(),
      tro_hearing_due: hearingDue,
      protective_order_due: poDate,
    });
  } catch (e) {
    logger.error('[tro POST]', e.message);
    res.status(500).json({ error: 'Could not create TRO tracker.' });
  }
});

router.patch('/tro/:id', authRequired, routeLimiter, async (req, res) => {
  try {
    const db    = await getDb();
    const memb  = await getFirmMembership(db, req.user.id);
    const troId = safeInt(req.params.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'paralegal')) return err403(res, 'Requires paralegal+.');

    const row = await db.get('SELECT id, firm_id, matter_id, client_name, dv_flag, tro_filed, tro_hearing_due, protective_order_due, tro_granted, tro_served, asset_tier, notes, created_at, updated_at FROM tro_trackers WHERE id=? AND firm_id=?', [troId, memb.firm_id]);
    if (!row) return err404(res, 'TRO tracker not found.');

    const { tro_granted, tro_served, notes } = req.body || {};
    const updates = [], params = [];
    if (tro_granted !== undefined) { updates.push('tro_granted=?'); params.push(tro_granted ? 1 : 0); }
    if (tro_served  !== undefined) { updates.push('tro_served=?');  params.push(tro_served ? 1 : 0); }
    // notes: undefined=no-change, empty-string=clear, non-empty=update
    if (notes !== undefined)       { updates.push('notes=?');       params.push(notes ? sanitizeStr(truncateStr(notes, 1000), 1000) : null); }
    if (!updates.length) return err400(res, 'No fields to update.');

    updates.push('updated_at=?'); params.push(new Date().toISOString());
    params.push(troId);
    await db.run(`UPDATE tro_trackers SET ${updates.join(',')} WHERE id=?`, params);

    const updated = await db.get('SELECT id, firm_id, matter_id, client_name, dv_flag, tro_filed, tro_hearing_due, protective_order_due, tro_granted, tro_served, asset_tier, notes, created_at, updated_at FROM tro_trackers WHERE id=?', [troId]);
    res.json({ updated: true, tracker: updated || { id: troId, updated_at: new Date().toISOString() } });
  } catch (e) {
    logger.error('[tro PATCH]', e.message);
    res.status(500).json({ error: 'Could not update TRO tracker.' });
  }
});

router.delete('/tro/:id', authRequired, async (req, res) => {
  try {
    const db    = await getDb();
    const memb  = await getFirmMembership(db, req.user.id);
    const troId = safeInt(req.params.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'partner')) return err403(res, 'Requires partner+.');
    const row = await db.get('SELECT id FROM tro_trackers WHERE id=? AND firm_id=?', [troId, memb.firm_id]);
    if (!row) return err404(res, 'TRO tracker not found.');
    await db.run('DELETE FROM tro_trackers WHERE id=?', [troId]);
    res.json({ deleted: true, id: troId });
  } catch (e) {
    logger.error('[tro DELETE]', e.message);
    res.status(500).json({ error: 'Could not delete TRO tracker.' });
  }
});

// ─── MATTER EVIDENCE / VULNERABILITY SCORING (VAR-C + VAR-D) ────────────────

router.patch('/matters/:id/scoring', authRequired, routeLimiter, async (req, res) => {
  try {
    const db       = await getDb();
    const memb     = await getFirmMembership(db, req.user.id);
    const matterId = safeInt(req.params.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const { evidence_score, vulnerability_level, time_pressure } = req.body || {};

    if (vulnerability_level !== undefined && !VALID_VULNERABILITY.includes(vulnerability_level)) {
      return err400(res, `vulnerability_level must be one of: ${VALID_VULNERABILITY.join(', ')}`);
    }
    if (time_pressure !== undefined && !VALID_TIME_PRESSURE.includes(time_pressure)) {
      return err400(res, `time_pressure must be one of: ${VALID_TIME_PRESSURE.join(', ')}`);
    }

    const matter = await db.get(
      'SELECT id, firm_id FROM matters WHERE id=?',
      [matterId]
    );
    if (!matter) return err404(res, 'Matter not found.');
    if (matter.firm_id && matter.firm_id !== memb.firm_id) return err403(res, 'Not your firm\'s matter.');

    // Capture before-state BEFORE the UPDATE for accurate audit diff
    const beforeScore = await db.get(
      'SELECT evidence_score, evidence_bucket, vulnerability_level, time_pressure FROM matters WHERE id=?',
      [matterId]
    ).catch(() => null);

    const updates = [], params = [];
    if (evidence_score !== undefined && evidence_score !== null) {
      if (evidence_score === '') return err400(res, 'evidence_score must be a number between 0 and 100.');
      const numericScore = Number(evidence_score);
      if (isNaN(numericScore)) return err400(res, 'evidence_score must be a number between 0 and 100.');
      const score = Math.max(0, Math.min(100, Math.round(numericScore)));
      updates.push('evidence_score=?', 'evidence_bucket=?');
      params.push(score, evidenceBucket(score));
    }
    if (vulnerability_level !== undefined && VALID_VULNERABILITY.includes(vulnerability_level)) {
      updates.push('vulnerability_level=?'); params.push(vulnerability_level);
    }
    if (time_pressure !== undefined && VALID_TIME_PRESSURE.includes(time_pressure)) {
      updates.push('time_pressure=?'); params.push(time_pressure);
    }
    if (!updates.length) return err400(res, 'No scoring fields provided.');

    updates.push('updated_at=?'); params.push(new Date().toISOString());
    params.push(matterId);
    await db.run(`UPDATE matters SET ${updates.join(',')} WHERE id=?`, params);

    await writeAuditLog(db, {
      user_id: req.user.id, firm_id: memb.firm_id,
      action: 'update', resource: 'matter_scoring',
      record_id: matterId,
      old_value: beforeScore,
      new_value: { evidence_score, vulnerability_level, time_pressure },
      ip: req.ip, ua: req.headers['user-agent'],
    });

    const updated = await db.get(
      'SELECT id, evidence_score, evidence_bucket, vulnerability_level, time_pressure FROM matters WHERE id=?',
      [matterId]
    );
    res.json({ updated: true, matter: updated || { id: matterId, updated_at: new Date().toISOString() } });
  } catch (e) {
    logger.error('[matters/scoring PATCH]', e.message);
    res.status(500).json({ error: 'Could not update matter scoring.' });
  }
});


// ─── PLEA OFFER TRACKER ───────────────────────────────────────────────────────
// Tracks DA/prosecution offers, expiry, Padilla warning documentation.
// 97% of convictions come from pleas — this tracker is central to criminal defense.

const VALID_PLEA_TYPE   = ['guilty','nolo','alford','best_interest','deferred'];
const VALID_PLEA_STATUS = ['pending','accepted','rejected','expired','withdrawn','countered'];
const VALID_IMM_STATUS  = ['citizen','lpr','visa','asylee','refugee','daca','undocumented','tps','unknown'];

router.get('/plea-offers', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const limit  = Math.min(safeInt(req.query.limit, 50), 200);
    const offset = safeInt(req.query.offset, 0);
    const status = req.query.status ? sanitizeStr(req.query.status, 30) : null;

    let sql    = 'SELECT * FROM plea_offers WHERE firm_id=?'; /* intentional: full record for vertical UI */
    const args = [memb.firm_id];
    if (status) { sql += ' AND status=?'; args.push(status); }
    sql += ' ORDER BY expires_date ASC NULLS LAST, offered_date DESC LIMIT ? OFFSET ?';
    args.push(limit, offset);

    const rows = await db.all(sql, args).catch(() => []);
    const today = new Date();

    const enriched = rows.map(r => {
      let days_until_expiry = null;
      let expiry_critical   = false;
      if (r.expires_date && r.status === 'pending') {
        days_until_expiry = Math.ceil((new Date(r.expires_date) - today) / 86400000);
        expiry_critical   = days_until_expiry >= 0 && days_until_expiry <= 2;
      }
      return { ...r, days_until_expiry, expiry_critical };
    });

    res.json({ offers: enriched, total: enriched.length, limit, offset });
  } catch (e) {
    logger.error('[plea-offers GET]', e.message);
    res.status(500).json({ error: 'Could not load plea offers.' });
  }
});

router.post('/plea-offers', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const {
      matter_id, offered_date, expires_date, expires_time,
      charge_original, charge_offered, sentence_rec,
      fine_cents = 0, probation_months = 0, prison_months_min = 0, prison_months_max = 0,
      plea_type = 'guilty', conditions,
      non_citizen = 0, padilla_warning_given = 0, padilla_given_date, padilla_consequences,
      notes,
    } = req.body || {};

    if (!offered_date)              return err400(res, 'offered_date required.');
    if (!isValidDate(offered_date)) return err400(res, 'offered_date must be YYYY-MM-DD.');
    if (expires_date && !isValidDate(expires_date)) return err400(res, 'expires_date must be YYYY-MM-DD.');
    if (!VALID_PLEA_TYPE.includes(plea_type)) return err400(res, `plea_type must be one of: ${VALID_PLEA_TYPE.join(', ')}.`);

    const matterErr = await validateMatterId(db, matter_id, memb.firm_id, res);
    if (matterErr) return;

    const r = await db.run(
      `INSERT INTO plea_offers
         (matter_id, firm_id, created_by, offered_date, expires_date, expires_time,
          charge_original, charge_offered, sentence_rec, fine_cents, probation_months,
          prison_months_min, prison_months_max, plea_type, conditions,
          non_citizen, padilla_warning_given, padilla_given_date, padilla_consequences, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        matter_id ? safeInt(matter_id) : null, memb.firm_id, req.user.id,
        offered_date, expires_date || null, expires_time || null,
        charge_original ? sanitizeStr(truncateStr(charge_original, 500), 500) : null,
        charge_offered  ? sanitizeStr(truncateStr(charge_offered, 500), 500)  : null,
        sentence_rec    ? sanitizeStr(truncateStr(sentence_rec, 500), 500)    : null,
        safeInt(fine_cents, 0), safeInt(probation_months, 0),
        safeInt(prison_months_min, 0), safeInt(prison_months_max, 0),
        plea_type,
        conditions ? sanitizeStr(truncateStr(String(conditions), 1000), 1000) : null,
        non_citizen ? 1 : 0, padilla_warning_given ? 1 : 0,
        padilla_given_date && isValidDate(padilla_given_date) ? padilla_given_date : null,
        padilla_consequences ? sanitizeStr(truncateStr(padilla_consequences, 2000), 2000) : null,
        notes ? sanitizeStr(truncateStr(notes, 2000), 2000) : null,
      ]
    );

    // Update matter flags for signal engine
    if (matter_id) {
      await db.run(
        "UPDATE matters SET plea_offer_pending=1, plea_expires_date=?, non_citizen=?, updated_at=datetime('now') WHERE id=?",
        [expires_date || null, non_citizen ? 1 : 0, safeInt(matter_id)]
      ).catch(() => {});
    }

    res.status(201).json({ created: true, id: r.lastID });
  } catch (e) {
    logger.error('[plea-offers POST]', e.message);
    res.status(500).json({ error: 'Could not create plea offer.' });
  }
});

router.patch('/plea-offers/:id', authRequired, routeLimiter, async (req, res) => {
  try {
    const db     = await getDb();
    const memb   = await getFirmMembership(db, req.user.id);
    const offerId = safeInt(req.params.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const row = await db.get('SELECT * FROM plea_offers WHERE id=? AND firm_id=?', [offerId, memb.firm_id]);  /* intentional: full record for vertical UI */
    if (!row) return err404(res, 'Plea offer not found.');

    const updates = [], params = [];
    const {
      status, decision_date, client_initiated_rejection, rejection_notes,
      padilla_warning_given, padilla_given_date, padilla_consequences,
      expires_date, sentence_rec, conditions, notes,
    } = req.body || {};

    if (status !== undefined) {
      if (!VALID_PLEA_STATUS.includes(status)) return err400(res, `status must be one of: ${VALID_PLEA_STATUS.join(', ')}.`);
      updates.push('status=?'); params.push(status);
    }
    if (decision_date !== undefined)            { updates.push('decision_date=?');             params.push(decision_date && isValidDate(decision_date) ? decision_date : null); }
    if (client_initiated_rejection !== undefined){ updates.push('client_initiated_rejection=?'); params.push(client_initiated_rejection ? 1 : 0); }
    if (rejection_notes !== undefined)          { updates.push('rejection_notes=?');           params.push(rejection_notes ? sanitizeStr(truncateStr(rejection_notes, 2000), 2000) : null); }
    if (padilla_warning_given !== undefined)    { updates.push('padilla_warning_given=?');     params.push(padilla_warning_given ? 1 : 0); }
    if (padilla_given_date !== undefined)       { updates.push('padilla_given_date=?');        params.push(padilla_given_date && isValidDate(padilla_given_date) ? padilla_given_date : null); }
    if (padilla_consequences !== undefined)     { updates.push('padilla_consequences=?');      params.push(padilla_consequences ? sanitizeStr(truncateStr(padilla_consequences, 2000), 2000) : null); }
    if (expires_date !== undefined)             { updates.push('expires_date=?');              params.push(expires_date && isValidDate(expires_date) ? expires_date : null); }
    if (sentence_rec !== undefined)             { updates.push('sentence_rec=?');              params.push(sentence_rec ? sanitizeStr(truncateStr(sentence_rec, 500), 500) : null); }
    if (conditions !== undefined)               { updates.push('conditions=?');                params.push(conditions ? sanitizeStr(truncateStr(String(conditions), 1000), 1000) : null); }
    if (notes !== undefined)                    { updates.push('notes=?');                     params.push(notes ? sanitizeStr(truncateStr(notes, 2000), 2000) : null); }
    if (!updates.length) return err400(res, 'No fields to update.');

    updates.push("updated_at=datetime('now')");
    params.push(offerId);
    await db.run(`UPDATE plea_offers SET ${updates.join(',')} WHERE id=?`, params);

    // If offer resolved, update matter flag
    const resolved = ['accepted','rejected','expired','withdrawn'].includes(status);
    if (resolved && row.matter_id) {
      await db.run(
        "UPDATE matters SET plea_offer_pending=0, updated_at=datetime('now') WHERE id=?",
        [row.matter_id]
      ).catch(() => {});
    }

    const updated = await db.get('SELECT * FROM plea_offers WHERE id=?', [offerId]);  /* intentional: full record for vertical UI */
    res.json({ updated: true, offer: updated || { id: offerId, updated_at: new Date().toISOString() } });
  } catch (e) {
    logger.error('[plea-offers PATCH]', e.message);
    res.status(500).json({ error: 'Could not update plea offer.' });
  }
});

// ─── VOLUNTARY DEPARTURE TRACKER ─────────────────────────────────────────────

router.get('/voluntary-departure', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const rows = await db.all(
      "SELECT * FROM voluntary_departure WHERE firm_id=? ORDER BY departure_deadline ASC",  /* intentional: full record for vertical UI */
      [memb.firm_id]
    ).catch(() => []);

    const today = new Date();
    const enriched = rows.map(r => {
      const deadline     = new Date(r.departure_deadline + 'T23:59:59Z');
      const days_until   = Math.ceil((deadline - today) / 86400000);
      const imminent     = r.status === 'pending' && days_until >= 0 && days_until <= 14;
      const bar_risk     = r.status === 'pending' && days_until < 0;  // already missed
      const bar_10yr_active = r.status === 'missed' || bar_risk;
      return { ...r, days_until_deadline: Math.max(days_until, 0), imminent, bar_10yr_active };
    });

    res.json({ departures: enriched, total: enriched.length, firm_id: memb.firm_id });
  } catch (e) {
    logger.error('[voluntary-departure GET]', e.message);
    res.status(500).json({ error: 'Could not load voluntary departure orders.' });
  }
});

router.post('/voluntary-departure', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const { matter_id, client_name, a_number, order_date, departure_deadline,
            departure_country, bond_amount_cents = 0, notes } = req.body || {};

    if (!client_name?.trim())           return err400(res, 'client_name required.');
    if (!order_date)                    return err400(res, 'order_date required.');
    if (!departure_deadline)            return err400(res, 'departure_deadline required.');
    if (!isValidDate(order_date))       return err400(res, 'order_date must be YYYY-MM-DD.');
    if (!isValidDate(departure_deadline)) return err400(res, 'departure_deadline must be YYYY-MM-DD.');
    if (!departure_country?.trim())     return err400(res, 'departure_country required.');

    const matterErr = await validateMatterId(db, matter_id, memb.firm_id, res);
    if (matterErr) return;

    const r = await db.run(
      `INSERT INTO voluntary_departure
         (matter_id, firm_id, created_by, client_name, a_number, order_date,
          departure_deadline, departure_country, bond_amount_cents, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        matter_id ? safeInt(matter_id) : null, memb.firm_id, req.user.id,
        sanitizeStr(truncateStr(client_name.trim(), 200), 200),
        a_number ? sanitizeStr(a_number, 20) : null,
        order_date, departure_deadline,
        sanitizeStr(truncateStr(departure_country.trim(), 100), 100),
        safeInt(bond_amount_cents, 0),
        notes ? sanitizeStr(truncateStr(notes, 2000), 2000) : null,
      ]
    );

    // Set the vol_departure_date on the matter for signal computation
    if (matter_id) {
      await db.run(
        "UPDATE matters SET vol_departure_date=?, updated_at=datetime('now') WHERE id=?",
        [departure_deadline, safeInt(matter_id)]
      ).catch(() => {});
    }

    res.status(201).json({ created: true, id: r.lastID });
  } catch (e) {
    logger.error('[voluntary-departure POST]', e.message);
    res.status(500).json({ error: 'Could not create voluntary departure order.' });
  }
});

router.patch('/voluntary-departure/:id', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    const vdId = safeInt(req.params.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const row = await db.get('SELECT * FROM voluntary_departure WHERE id=? AND firm_id=?', [vdId, memb.firm_id]);  /* intentional: full record for vertical UI */
    if (!row) return err404(res, 'Voluntary departure record not found.');

    const VALID_VD_STATUS = ['pending','departed','missed','extended','withdrawn'];
    const updates = [], params = [];
    const { status, departed_date, departure_proof, withholding_eligible, cat_eligible, notes } = req.body || {};

    if (status !== undefined) {
      if (!VALID_VD_STATUS.includes(status)) return err400(res, `status must be one of: ${VALID_VD_STATUS.join(', ')}.`);
      updates.push('status=?'); params.push(status);
    }
    if (departed_date !== undefined)        { updates.push('departed_date=?');        params.push(departed_date && isValidDate(departed_date) ? departed_date : null); }
    if (departure_proof !== undefined)      { updates.push('departure_proof=?');      params.push(departure_proof ? sanitizeStr(truncateStr(departure_proof, 500), 500) : null); }
    if (withholding_eligible !== undefined) { updates.push('withholding_eligible=?'); params.push(withholding_eligible ? 1 : 0); }
    if (cat_eligible !== undefined)         { updates.push('cat_eligible=?');         params.push(cat_eligible ? 1 : 0); }
    if (notes !== undefined)                { updates.push('notes=?');                params.push(notes ? sanitizeStr(truncateStr(notes, 2000), 2000) : null); }
    if (!updates.length) return err400(res, 'No fields to update.');

    updates.push("updated_at=datetime('now')");
    params.push(vdId);
    await db.run(`UPDATE voluntary_departure SET ${updates.join(',')} WHERE id=?`, params);

    res.json({ updated: true });
  } catch (e) {
    logger.error('[voluntary-departure PATCH]', e.message);
    res.status(500).json({ error: 'Could not update voluntary departure record.' });
  }
});

// ─── VOP TRACKER ─────────────────────────────────────────────────────────────

router.get('/vop', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const rows = await db.all(
      "SELECT * FROM vop_trackers WHERE firm_id=? ORDER BY vop_hearing_date ASC NULLS LAST, violation_date DESC",  /* intentional: full record for vertical UI */
      [memb.firm_id]
    ).catch(() => []);

    const today = new Date();
    const enriched = rows.map(r => {
      const hearing_overdue = r.vop_hearing_date && new Date(r.vop_hearing_date) < today && r.status === 'hearing_set';
      const days_until_hearing = r.vop_hearing_date
        ? Math.ceil((new Date(r.vop_hearing_date) - today) / 86400000)
        : null;
      return { ...r, hearing_overdue, days_until_hearing };
    });

    res.json({ vop_trackers: enriched, total: enriched.length, firm_id: memb.firm_id });
  } catch (e) {
    logger.error('[vop GET]', e.message);
    res.status(500).json({ error: 'Could not load VOP trackers.' });
  }
});

router.post('/vop', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const VALID_VOP_TYPE = ['new_arrest','failed_drug_test','missed_reporting',
      'travel_violation','employment','contact_violation','financial','weapons','absconded'];

    const {
      matter_id, original_matter_id, supervised_release_id,
      client_name, violation_type = 'new_arrest', violation_date,
      violation_description, detained_on_vop = 0, original_sentence_months = 0, notes,
    } = req.body || {};

    if (!client_name?.trim())               return err400(res, 'client_name required.');
    if (!violation_date)                    return err400(res, 'violation_date required.');
    if (!isValidDate(violation_date))       return err400(res, 'violation_date must be YYYY-MM-DD.');
    if (!VALID_VOP_TYPE.includes(violation_type)) return err400(res, `violation_type must be one of: ${VALID_VOP_TYPE.join(', ')}.`);

    const r = await db.run(
      `INSERT INTO vop_trackers
         (matter_id, original_matter_id, supervised_release_id, firm_id, created_by,
          client_name, violation_type, violation_date, violation_description,
          detained_on_vop, original_sentence_months, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        matter_id ? safeInt(matter_id) : null,
        original_matter_id ? safeInt(original_matter_id) : null,
        supervised_release_id ? safeInt(supervised_release_id) : null,
        memb.firm_id, req.user.id,
        sanitizeStr(truncateStr(client_name.trim(), 200), 200),
        violation_type, violation_date,
        violation_description ? sanitizeStr(truncateStr(violation_description, 2000), 2000) : null,
        detained_on_vop ? 1 : 0,
        safeInt(original_sentence_months, 0),
        notes ? sanitizeStr(truncateStr(notes, 2000), 2000) : null,
      ]
    );

    // Flag the matter for signal engine
    if (matter_id) {
      await db.run(
        "UPDATE matters SET supervised_release=1, updated_at=datetime('now') WHERE id=?",
        [safeInt(matter_id)]
      ).catch(() => {});
    }

    res.status(201).json({ created: true, id: r.lastID });
  } catch (e) {
    logger.error('[vop POST]', e.message);
    res.status(500).json({ error: 'Could not create VOP tracker.' });
  }
});

router.patch('/vop/:id', authRequired, routeLimiter, async (req, res) => {
  try {
    const db    = await getDb();
    const memb  = await getFirmMembership(db, req.user.id);
    const vopId = safeInt(req.params.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const row = await db.get('SELECT id FROM vop_trackers WHERE id=? AND firm_id=?', [vopId, memb.firm_id]);
    if (!row) return err404(res, 'VOP tracker not found.');

    const VALID_VOP_STATUS  = ['pending','hearing_set','admitted','denied','revoked','modified','dismissed'];
    const VALID_VOP_OUTCOME = ['revoked_full','revoked_partial','modified','reinstated','dismissed'];

    const updates = [], params = [];
    const { status, vop_petition_date, vop_hearing_date, vop_hearing_deadline, outcome, notes } = req.body || {};

    if (status !== undefined) {
      if (!VALID_VOP_STATUS.includes(status)) return err400(res, `status must be one of: ${VALID_VOP_STATUS.join(', ')}.`);
      updates.push('status=?'); params.push(status);
    }
    if (vop_petition_date !== undefined)   { updates.push('vop_petition_date=?');   params.push(vop_petition_date && isValidDate(vop_petition_date) ? vop_petition_date : null); }
    if (vop_hearing_date !== undefined)    { updates.push('vop_hearing_date=?');     params.push(vop_hearing_date && isValidDate(vop_hearing_date) ? vop_hearing_date : null); }
    if (vop_hearing_deadline !== undefined){ updates.push('vop_hearing_deadline=?'); params.push(vop_hearing_deadline && isValidDate(vop_hearing_deadline) ? vop_hearing_deadline : null); }
    if (outcome !== undefined) {
      if (outcome && !VALID_VOP_OUTCOME.includes(outcome)) return err400(res, `outcome must be one of: ${VALID_VOP_OUTCOME.join(', ')}.`);
      updates.push('outcome=?'); params.push(outcome || null);
    }
    if (notes !== undefined) { updates.push('notes=?'); params.push(notes ? sanitizeStr(truncateStr(notes, 2000), 2000) : null); }
    if (!updates.length) return err400(res, 'No fields to update.');

    updates.push("updated_at=datetime('now')");
    params.push(vopId);
    await db.run(`UPDATE vop_trackers SET ${updates.join(',')} WHERE id=?`, params);
    res.json({ updated: true });
  } catch (e) {
    logger.error('[vop PATCH]', e.message);
    res.status(500).json({ error: 'Could not update VOP tracker.' });
  }
});

// ─── DV FIREARM SURRENDER TRACKER ────────────────────────────────────────────

router.get('/dv-firearms', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const rows = await db.all(
      "SELECT * FROM dv_firearm_surrender WHERE firm_id=? ORDER BY surrender_deadline ASC",  /* intentional: full record for vertical UI */
      [memb.firm_id]
    ).catch(() => []);

    const today = new Date();
    const enriched = rows.map(r => {
      const deadline = new Date(r.surrender_deadline + 'T23:59:59Z');
      const days_until = Math.ceil((deadline - today) / 86400000);
      const overdue    = r.status === 'pending' && days_until < 0;
      return { ...r, days_until_deadline: days_until, deadline_overdue: overdue };
    });

    res.json({ firearms: enriched, total: enriched.length });
  } catch (e) {
    logger.error('[dv-firearms GET]', e.message);
    res.status(500).json({ error: 'Could not load firearm surrender records.' });
  }
});

router.post('/dv-firearms', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const { matter_id, tro_tracker_id, client_name, tro_issue_date,
            surrender_deadline, surrender_to = 'law_enforcement',
            firearms_count, firearms_description, notes } = req.body || {};

    if (!client_name?.trim())               return err400(res, 'client_name required.');
    if (!tro_issue_date)                    return err400(res, 'tro_issue_date required.');
    if (!surrender_deadline)                return err400(res, 'surrender_deadline required.');
    if (!isValidDate(tro_issue_date))       return err400(res, 'tro_issue_date must be YYYY-MM-DD.');
    if (!isValidDate(surrender_deadline))   return err400(res, 'surrender_deadline must be YYYY-MM-DD.');

    const r = await db.run(
      `INSERT INTO dv_firearm_surrender
         (matter_id, firm_id, created_by, client_name, tro_tracker_id, tro_issue_date,
          surrender_deadline, surrender_to, firearms_count, firearms_description, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        matter_id ? safeInt(matter_id) : null, memb.firm_id, req.user.id,
        sanitizeStr(truncateStr(client_name.trim(), 200), 200),
        tro_tracker_id ? safeInt(tro_tracker_id) : null,
        tro_issue_date, surrender_deadline,
        sanitizeStr(surrender_to, 50),
        firearms_count !== undefined ? safeInt(firearms_count, 0) : null,
        firearms_description ? sanitizeStr(truncateStr(firearms_description, 500), 500) : null,
        notes ? sanitizeStr(truncateStr(notes, 2000), 2000) : null,
      ]
    );
    res.status(201).json({ created: true, id: r.lastID });
  } catch (e) {
    logger.error('[dv-firearms POST]', e.message);
    res.status(500).json({ error: 'Could not create firearm surrender record.' });
  }
});

router.patch('/dv-firearms/:id', authRequired, routeLimiter, async (req, res) => {
  try {
    const db    = await getDb();
    const memb  = await getFirmMembership(db, req.user.id);
    const fsId  = safeInt(req.params.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const row = await db.get('SELECT id FROM dv_firearm_surrender WHERE id=? AND firm_id=?', [fsId, memb.firm_id]);
    if (!row) return err404(res, 'Firearm surrender record not found.');

    const VALID_FS_STATUS = ['pending','complied','partial','noncompliant','exempt'];
    const updates = [], params = [];
    const { status, complied_date, receipt_obtained, receipt_reference, contempt_filed, notes } = req.body || {};

    if (status !== undefined) {
      if (!VALID_FS_STATUS.includes(status)) return err400(res, `status must be one of: ${VALID_FS_STATUS.join(', ')}.`);
      updates.push('status=?'); params.push(status);
    }
    if (complied_date !== undefined)    { updates.push('complied_date=?');    params.push(complied_date && isValidDate(complied_date) ? complied_date : null); }
    if (receipt_obtained !== undefined) { updates.push('receipt_obtained=?'); params.push(receipt_obtained ? 1 : 0); }
    if (receipt_reference !== undefined){ updates.push('receipt_reference=?');params.push(receipt_reference ? sanitizeStr(receipt_reference, 200) : null); }
    if (contempt_filed !== undefined)   { updates.push('contempt_filed=?');   params.push(contempt_filed ? 1 : 0); }
    if (notes !== undefined)            { updates.push('notes=?');            params.push(notes ? sanitizeStr(truncateStr(notes, 2000), 2000) : null); }
    if (!updates.length) return err400(res, 'No fields to update.');

    updates.push("updated_at=datetime('now')");
    params.push(fsId);
    await db.run(`UPDATE dv_firearm_surrender SET ${updates.join(',')} WHERE id=?`, params);
    res.json({ updated: true });
  } catch (e) {
    logger.error('[dv-firearms PATCH]', e.message);
    res.status(500).json({ error: 'Could not update firearm surrender record.' });
  }
});

// ─── BOP EXHAUSTION TRACKER ───────────────────────────────────────────────────

router.get('/bop-exhaustion', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const rows = await db.all(
      "SELECT * FROM bop_exhaustion WHERE firm_id=? ORDER BY thirty_day_lapse_date ASC NULLS LAST",  /* intentional: full record for vertical UI */
      [memb.firm_id]
    ).catch(() => []);

    const today = new Date();
    const enriched = rows.map(r => {
      const lapseDate = r.thirty_day_lapse_date ? new Date(r.thirty_day_lapse_date) : null;
      const days_until_eligible = lapseDate
        ? Math.ceil((lapseDate - today) / 86400000)
        : null;
      const court_eligible = lapseDate ? lapseDate <= today : false;
      return { ...r, days_until_court_eligible: days_until_eligible, court_eligible };
    });

    res.json({ records: enriched, total: enriched.length });
  } catch (e) {
    logger.error('[bop-exhaustion GET]', e.message);
    res.status(500).json({ error: 'Could not load BOP exhaustion records.' });
  }
});

router.post('/bop-exhaustion', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const VALID_BOP_BASIS = ['medical','age_and_medical','caregiver','other','ussc_2023'];
    const {
      matter_id, client_name, bop_number, facility, basis = 'medical',
      qualifying_condition, warden_request_date, notes,
    } = req.body || {};

    if (!client_name?.trim())               return err400(res, 'client_name required.');
    if (!VALID_BOP_BASIS.includes(basis))   return err400(res, `basis must be one of: ${VALID_BOP_BASIS.join(', ')}.`);
    if (warden_request_date && !isValidDate(warden_request_date)) return err400(res, 'warden_request_date must be YYYY-MM-DD.');

    // Calculate the 30-day lapse date automatically
    const thirtyDayLapse = warden_request_date
      ? (() => { const d = new Date(warden_request_date); d.setUTCDate(d.getUTCDate() + 30); return d.toISOString().slice(0,10); })()
      : null;

    const r = await db.run(
      `INSERT INTO bop_exhaustion
         (matter_id, firm_id, created_by, client_name, bop_number, facility, basis,
          qualifying_condition, warden_request_date, thirty_day_lapse_date, status, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        matter_id ? safeInt(matter_id) : null, memb.firm_id, req.user.id,
        sanitizeStr(truncateStr(client_name.trim(), 200), 200),
        bop_number ? sanitizeStr(bop_number, 30) : null,
        facility   ? sanitizeStr(truncateStr(facility, 200), 200) : null,
        basis,
        qualifying_condition ? sanitizeStr(truncateStr(qualifying_condition, 2000), 2000) : null,
        warden_request_date || null,
        thirtyDayLapse,
        warden_request_date ? 'warden_submitted' : 'pending',
        notes ? sanitizeStr(truncateStr(notes, 2000), 2000) : null,
      ]
    );

    // Set bop_request_date on matter for signal engine
    if (matter_id && warden_request_date) {
      await db.run(
        "UPDATE matters SET bop_request_date=?, updated_at=datetime('now') WHERE id=?",
        [warden_request_date, safeInt(matter_id)]
      ).catch(() => {});
    }

    res.status(201).json({ created: true, id: r.lastID, thirty_day_lapse: thirtyDayLapse });
  } catch (e) {
    logger.error('[bop-exhaustion POST]', e.message);
    res.status(500).json({ error: 'Could not create BOP exhaustion record.' });
  }
});

router.patch('/bop-exhaustion/:id', authRequired, routeLimiter, async (req, res) => {
  try {
    const db    = await getDb();
    const memb  = await getFirmMembership(db, req.user.id);
    const bopId = safeInt(req.params.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const row = await db.get('SELECT * FROM bop_exhaustion WHERE id=? AND firm_id=?', [bopId, memb.firm_id]);  /* intentional: full record for vertical UI */
    if (!row) return err404(res, 'BOP exhaustion record not found.');

    const VALID_BOP_STATUS = ['pending','warden_submitted','30_day_lapsed','court_filed','granted','denied','appeal'];
    const updates = [], params = [];
    const { status, warden_response, warden_response_date, court_motion_filed,
            court_motion_date, court_decision, notes } = req.body || {};

    if (status !== undefined) {
      if (!VALID_BOP_STATUS.includes(status)) return err400(res, `status must be one of: ${VALID_BOP_STATUS.join(', ')}.`);
      updates.push('status=?'); params.push(status);
    }
    if (warden_response !== undefined)      { updates.push('warden_response=?');      params.push(sanitizeStr(warden_response, 50)); }
    if (warden_response_date !== undefined) { updates.push('warden_response_date=?'); params.push(warden_response_date && isValidDate(warden_response_date) ? warden_response_date : null); }
    if (court_motion_filed !== undefined)   { updates.push('court_motion_filed=?');   params.push(court_motion_filed ? 1 : 0); }
    if (court_motion_date !== undefined)    { updates.push('court_motion_date=?');    params.push(court_motion_date && isValidDate(court_motion_date) ? court_motion_date : null); }
    if (court_decision !== undefined)       { updates.push('court_decision=?');       params.push(court_decision ? sanitizeStr(court_decision, 50) : null); }
    if (notes !== undefined)                { updates.push('notes=?');                params.push(notes ? sanitizeStr(truncateStr(notes, 2000), 2000) : null); }
    if (!updates.length) return err400(res, 'No fields to update.');

    updates.push("updated_at=datetime('now')");
    params.push(bopId);
    await db.run(`UPDATE bop_exhaustion SET ${updates.join(',')} WHERE id=?`, params);
    res.json({ updated: true });
  } catch (e) {
    logger.error('[bop-exhaustion PATCH]', e.message);
    res.status(500).json({ error: 'Could not update BOP exhaustion record.' });
  }
});

// ─── CO-DEFENDANT LINKS ───────────────────────────────────────────────────────

router.get('/codefendants', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const matter_id = req.query.matter_id ? safeInt(req.query.matter_id) : null;
    let sql    = 'SELECT * FROM codefendant_links WHERE firm_id=?'; /* intentional: full record for vertical UI */
    const args = [memb.firm_id];
    if (matter_id) { sql += ' AND (matter_id_a=? OR matter_id_b=?)'; args.push(matter_id, matter_id); }
    sql += ' ORDER BY created_at DESC';

    const rows = await db.all(sql, args).catch(() => []);
    res.json({ codefendants: rows, total: rows.length });
  } catch (e) {
    logger.error('[codefendants GET]', e.message);
    res.status(500).json({ error: 'Could not load co-defendant links.' });
  }
});

router.post('/codefendants', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const VALID_LINK_TYPE = ['codefendant','related_case','jda'];
    const VALID_COOP = ['unknown','cooperating','not_cooperating','pled_guilty','acquitted'];

    const {
      matter_id_a, matter_id_b, codefendant_name_b, codefendant_attorney_b,
      link_type = 'codefendant', indictment_number, jda_active = 0, jda_date, jda_terms,
      codef_cooperation = 'unknown', bruton_issue = 0, notes,
    } = req.body || {};

    if (!matter_id_a) return err400(res, 'matter_id_a required.');
    if (!VALID_LINK_TYPE.includes(link_type)) return err400(res, `link_type must be one of: ${VALID_LINK_TYPE.join(', ')}.`);
    if (!VALID_COOP.includes(codef_cooperation)) return err400(res, `codef_cooperation must be one of: ${VALID_COOP.join(', ')}.`);

    const r = await db.run(
      `INSERT INTO codefendant_links
         (firm_id, created_by, matter_id_a, matter_id_b, codefendant_name_b, codefendant_attorney_b,
          link_type, indictment_number, jda_active, jda_date, jda_terms, codef_cooperation,
          codef_cooperation_updated, bruton_issue, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        memb.firm_id, req.user.id,
        safeInt(matter_id_a),
        matter_id_b ? safeInt(matter_id_b) : null,
        codefendant_name_b ? sanitizeStr(truncateStr(codefendant_name_b, 200), 200) : null,
        codefendant_attorney_b ? sanitizeStr(truncateStr(codefendant_attorney_b, 200), 200) : null,
        link_type,
        indictment_number ? sanitizeStr(indictment_number, 100) : null,
        jda_active ? 1 : 0,
        jda_date && isValidDate(jda_date) ? jda_date : null,
        jda_terms ? sanitizeStr(truncateStr(jda_terms, 2000), 2000) : null,
        codef_cooperation,
        codef_cooperation !== 'unknown' ? new Date().toISOString() : null,
        bruton_issue ? 1 : 0,
        notes ? sanitizeStr(truncateStr(notes, 2000), 2000) : null,
      ]
    );
    res.status(201).json({ created: true, id: r.lastID });
  } catch (e) {
    logger.error('[codefendants POST]', e.message);
    res.status(500).json({ error: 'Could not create co-defendant link.' });
  }
});

router.patch('/codefendants/:id', authRequired, routeLimiter, async (req, res) => {
  try {
    const db    = await getDb();
    const memb  = await getFirmMembership(db, req.user.id);
    const cdId  = safeInt(req.params.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const row = await db.get('SELECT id FROM codefendant_links WHERE id=? AND firm_id=?', [cdId, memb.firm_id]);
    if (!row) return err404(res, 'Co-defendant link not found.');

    const VALID_COOP = ['unknown','cooperating','not_cooperating','pled_guilty','acquitted'];
    const updates = [], params = [];
    const { codef_cooperation, bruton_issue, jda_active, jda_terms, notes } = req.body || {};

    if (codef_cooperation !== undefined) {
      if (!VALID_COOP.includes(codef_cooperation)) return err400(res, `codef_cooperation must be one of: ${VALID_COOP.join(', ')}.`);
      updates.push('codef_cooperation=?', 'codef_cooperation_updated=?');
      params.push(codef_cooperation, new Date().toISOString());
    }
    if (bruton_issue !== undefined) { updates.push('bruton_issue=?'); params.push(bruton_issue ? 1 : 0); }
    if (jda_active !== undefined)   { updates.push('jda_active=?');   params.push(jda_active ? 1 : 0); }
    if (jda_terms !== undefined)    { updates.push('jda_terms=?');    params.push(jda_terms ? sanitizeStr(truncateStr(jda_terms, 2000), 2000) : null); }
    if (notes !== undefined)        { updates.push('notes=?');        params.push(notes ? sanitizeStr(truncateStr(notes, 2000), 2000) : null); }
    if (!updates.length) return err400(res, 'No fields to update.');

    updates.push("updated_at=datetime('now')");
    params.push(cdId);
    await db.run(`UPDATE codefendant_links SET ${updates.join(',')} WHERE id=?`, params);
    res.json({ updated: true });
  } catch (e) {
    logger.error('[codefendants PATCH]', e.message);
    res.status(500).json({ error: 'Could not update co-defendant link.' });
  }
});



// ══════════════════════════════════════════════════════════════════════════════
// PADILLA WARNINGS
// Padilla v. Kentucky (2010): mandatory immigration consequence documentation.
// Documents that the attorney advised the non-citizen client of deportation
// consequences before a guilty plea — critical IAC prevention.
// GET  /padilla-warnings          — list for firm
// POST /padilla-warnings          — create warning record
// GET  /padilla-warnings/:id      — get single record
// ══════════════════════════════════════════════════════════════════════════════

const VALID_WARN_METHOD = ['verbal', 'written', 'email', 'certified_mail', 'court_filing'];

router.get('/padilla-warnings', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const limit  = Math.min(safeInt(req.query.limit, 50), 200);
    const offset = safeInt(req.query.offset, 0);
    const matterId = req.query.matter_id ? safeInt(req.query.matter_id) : null;

    let sql = `SELECT pw.*, u.display_name as given_by_name
               FROM padilla_warnings pw
               LEFT JOIN users u ON u.id = pw.given_by
               WHERE pw.firm_id=?`;
    const args = [memb.firm_id];
    if (matterId) { sql += ' AND pw.matter_id=?'; args.push(matterId); }
    sql += ' ORDER BY pw.warning_date DESC LIMIT ? OFFSET ?';
    args.push(limit, offset);

    const rows = await db.all(sql, args).catch(() => []);
    res.json({ warnings: rows, total: rows.length, limit, offset });
  } catch (e) {
    logger.error('[padilla-warnings GET]', e.message);
    res.status(500).json({ error: 'Could not load Padilla warnings.' });
  }
});

router.post('/padilla-warnings', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const {
      matter_id, client_name, a_number, immigration_status,
      warning_date, warning_method = 'in_person',
      interpreter_used = 0, interpreter_language,
      explained_deportation = 0, explained_inadmissibility = 0,
      explained_lpr_loss = 0, explained_bar_to_relief = 0,
      explained_daca_impact = 0, explained_family_separation = 0,
      explained_naturalization_bar = 0,
      charge_is_aggravated_felony = 0, charge_is_crime_of_moral_turp = 0,
      charge_is_deportable = 1,
      client_acknowledged = 0, client_signature_obtained = 0,
      client_requested_time_to_consult = 0,
      immigration_attorney_consulted = 0, referred_to_immigration = 0,
      notes,
    } = req.body || {};

    if (!client_name?.trim())           return err400(res, 'client_name required.');
    if (!warning_date)                  return err400(res, 'warning_date required.');
    if (!isValidDate(warning_date))     return err400(res, 'warning_date must be YYYY-MM-DD.');
    if (!VALID_WARN_METHOD.includes(warning_method)) return err400(res, `warning_method must be one of: ${VALID_WARN_METHOD.join(', ')}.`);
    if (immigration_status && !VALID_IMM_STATUS.includes(immigration_status)) return err400(res, `immigration_status must be one of: ${VALID_IMM_STATUS.join(', ')}.`);

    const matterErr = await validateMatterId(db, matter_id, memb.firm_id, res);
    if (matterErr) return;

    const r = await db.run(
      `INSERT INTO padilla_warnings
         (matter_id, firm_id, given_by, client_name, a_number, immigration_status,
          warning_date, warning_method, interpreter_used, interpreter_language,
          explained_deportation, explained_inadmissibility, explained_lpr_loss,
          explained_bar_to_relief, explained_daca_impact, explained_family_separation,
          explained_naturalization_bar, charge_is_aggravated_felony,
          charge_is_crime_of_moral_turp, charge_is_deportable,
          client_acknowledged, client_signature_obtained,
          client_requested_time_to_consult, immigration_attorney_consulted,
          referred_to_immigration, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        matter_id ? safeInt(matter_id) : null, memb.firm_id, req.user.id,
        sanitizeStr(truncateStr(client_name, 200), 200),
        a_number ? sanitizeStr(a_number, 20) : null,
        immigration_status || null, warning_date,
        warning_method, interpreter_used ? 1 : 0,
        interpreter_language ? sanitizeStr(interpreter_language, 100) : null,
        explained_deportation?1:0, explained_inadmissibility?1:0, explained_lpr_loss?1:0,
        explained_bar_to_relief?1:0, explained_daca_impact?1:0, explained_family_separation?1:0,
        explained_naturalization_bar?1:0, charge_is_aggravated_felony?1:0,
        charge_is_crime_of_moral_turp?1:0, charge_is_deportable?1:0,
        client_acknowledged?1:0, client_signature_obtained?1:0,
        client_requested_time_to_consult?1:0, immigration_attorney_consulted?1:0,
        referred_to_immigration?1:0,
        notes ? sanitizeStr(truncateStr(notes, 2000), 2000) : null,
      ]
    );
    res.status(201).json({ created: true, id: r.lastID });
  } catch (e) {
    logger.error('[padilla-warnings POST]', e.message);
    res.status(500).json({ error: 'Could not record Padilla warning.' });
  }
});

router.get('/padilla-warnings/:id', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    const row = await db.get('SELECT * FROM padilla_warnings WHERE id=? AND firm_id=?', [safeInt(req.params.id), memb.firm_id]);  /* intentional: full record for vertical UI */
    if (!row) return err404(res, 'Warning record not found.');
    res.json(row);
  } catch (e) {
    logger.error('[padilla-warnings/:id GET]', e.message);
    res.status(500).json({ error: 'Could not load warning record.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// COLLATERAL CONSEQUENCES
// Documents the "hidden sentence" — collateral consequences of conviction.
// ══════════════════════════════════════════════════════════════════════════════

router.get('/collateral-consequences', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const matterId = req.query.matter_id ? safeInt(req.query.matter_id) : null;
    let sql = 'SELECT * FROM collateral_consequences WHERE firm_id=?'; /* intentional: full record for vertical UI */
    const args = [memb.firm_id];
    if (matterId) { sql += ' AND matter_id=?'; args.push(matterId); }
    sql += ' ORDER BY created_at DESC LIMIT 100';

    const rows = await db.all(sql, args).catch(() => []);
    res.json({ consequences: rows, total: rows.length });
  } catch (e) {
    logger.error('[collateral-consequences GET]', e.message);
    res.status(500).json({ error: 'Could not load collateral consequences.' });
  }
});

router.post('/collateral-consequences', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const { matter_id, state, notes, ...flags } = req.body || {};
    const matterErr = await validateMatterId(db, matter_id, memb.firm_id, res);
    if (matterErr) return;

    // Boolean flag columns — safe-cast each
    const BOOL_COLS = [
      'professional_license_at_risk','employment_background_check_flag',
      'public_housing_disqualified','section_8_disqualified',
      'federal_student_loans_affected','pell_grant_affected',
      'voting_rights_lost','jury_duty_disqualified','firearm_prohibition',
      'deportable_offense','inadmissibility_trigger','mandatory_deportation','naturalization_bar',
      'sex_offender_registration','residence_restrictions','internet_restrictions',
      'snap_affected','tanf_affected','social_security_affected',
      'child_custody_impact','foster_care_adoption_bar',
      'military_service_bar','government_employment_bar','security_clearance_revoked',
      'drivers_license_suspended',
    ];
    const TEXT_COLS = [
      'professional_license_type','housing_note','voting_rights_restoration_path',
      'firearm_prohibition_duration','registration_duration','registration_duration',
    ];

    const cols = ['matter_id','firm_id','created_by','state','notes'];
    const vals = [matter_id ? safeInt(matter_id) : null, memb.firm_id, req.user.id,
                  state ? sanitizeStr(state, 5) : null,
                  notes ? sanitizeStr(truncateStr(notes, 2000), 2000) : null];

    for (const col of BOOL_COLS) {
      cols.push(col);
      vals.push(flags[col] ? 1 : 0);
    }
    for (const col of TEXT_COLS) {
      if (flags[col] !== undefined) {
        cols.push(col);
        vals.push(flags[col] ? sanitizeStr(truncateStr(String(flags[col]), 200), 200) : null);
      }
    }
    if (flags.drivers_license_suspension_months !== undefined) {
      cols.push('drivers_license_suspension_months'); // note: col name may vary
      vals.push(safeInt(flags.drivers_license_suspension_months, 0));
    }

    const r = await db.run(
      `INSERT INTO collateral_consequences (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`,
      vals
    );
    res.status(201).json({ created: true, id: r.lastID });
  } catch (e) {
    logger.error('[collateral-consequences POST]', e.message);
    res.status(500).json({ error: 'Could not record collateral consequences.' });
  }
});

router.patch('/collateral-consequences/:id', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    const ccId = safeInt(req.params.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');
    const row = await db.get('SELECT id FROM collateral_consequences WHERE id=? AND firm_id=?', [ccId, memb.firm_id]);
    if (!row) return err404(res, 'Record not found.');

    const updates = [], params = [];
    const updatable = [
      'professional_license_at_risk','public_housing_disqualified','voting_rights_lost',
      'firearm_prohibition','deportable_offense','mandatory_deportation',
      'sex_offender_registration','drivers_license_suspended','notes','state',
    ];
    for (const k of updatable) {
      if (req.body[k] !== undefined) {
        updates.push(`${k}=?`);
        params.push(typeof req.body[k] === 'boolean' || req.body[k] === 0 || req.body[k] === 1
          ? (req.body[k] ? 1 : 0)
          : sanitizeStr(truncateStr(String(req.body[k]), 500), 500));
      }
    }
    if (!updates.length) return err400(res, 'No fields to update.');
    updates.push("updated_at=datetime('now')");
    params.push(ccId);
    await db.run(`UPDATE collateral_consequences SET ${updates.join(',')} WHERE id=?`, params);
    res.json({ updated: true });
  } catch (e) {
    logger.error('[collateral-consequences PATCH]', e.message);
    res.status(500).json({ error: 'Could not update record.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ABILITY TO PAY — Bearden v. Georgia (1983)
// Courts cannot revoke probation solely for inability to pay when defendant
// is genuinely unable. Documents financial circumstances for Bearden hearings.
// ══════════════════════════════════════════════════════════════════════════════

router.get('/ability-to-pay', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const matterId = req.query.matter_id ? safeInt(req.query.matter_id) : null;
    let sql = 'SELECT * FROM ability_to_pay WHERE firm_id=?'; /* intentional: full record for vertical UI */
    const args = [memb.firm_id];
    if (matterId) { sql += ' AND matter_id=?'; args.push(matterId); }
    sql += ' ORDER BY assessment_date DESC LIMIT 100';

    const rows = await db.all(sql, args).catch(() => []);
    res.json({ assessments: rows, total: rows.length });
  } catch (e) {
    logger.error('[ability-to-pay GET]', e.message);
    res.status(500).json({ error: 'Could not load ability-to-pay assessments.' });
  }
});

router.post('/ability-to-pay', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const {
      matter_id, client_name, assessment_date,
      fines_total_cents = 0, restitution_total_cents = 0, fees_total_cents = 0,
      monthly_payment_required = 0, monthly_income_cents = 0, monthly_expenses_cents = 0,
      employed = 0, employment_barriers, dependents_count = 0,
      receives_public_benefits = 0, assets_value_cents = 0,
      can_pay_full = 0, can_pay_partial = 0, genuinely_unable = 0,
      bearden_motion_filed = 0, bearden_motion_date, notes,
    } = req.body || {};

    if (!client_name?.trim())          return err400(res, 'client_name required.');
    if (!assessment_date)              return err400(res, 'assessment_date required.');
    if (!isValidDate(assessment_date)) return err400(res, 'assessment_date must be YYYY-MM-DD.');

    const matterErr = await validateMatterId(db, matter_id, memb.firm_id, res);
    if (matterErr) return;

    const r = await db.run(
      `INSERT INTO ability_to_pay
         (matter_id, firm_id, created_by, client_name, assessment_date,
          fines_total_cents, restitution_total_cents, fees_total_cents,
          monthly_payment_required, monthly_income_cents, monthly_expenses_cents,
          employed, employment_barriers, dependents_count, receives_public_benefits,
          assets_value_cents, can_pay_full, can_pay_partial, genuinely_unable,
          bearden_motion_filed, bearden_motion_date, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        matter_id ? safeInt(matter_id) : null, memb.firm_id, req.user.id,
        sanitizeStr(truncateStr(client_name, 200), 200), assessment_date,
        safeInt(fines_total_cents,0), safeInt(restitution_total_cents,0), safeInt(fees_total_cents,0),
        safeInt(monthly_payment_required,0), safeInt(monthly_income_cents,0), safeInt(monthly_expenses_cents,0),
        employed?1:0, employment_barriers ? sanitizeStr(truncateStr(employment_barriers,500),500) : null,
        safeInt(dependents_count,0), receives_public_benefits?1:0, safeInt(assets_value_cents,0),
        can_pay_full?1:0, can_pay_partial?1:0, genuinely_unable?1:0,
        bearden_motion_filed?1:0,
        bearden_motion_date && isValidDate(bearden_motion_date) ? bearden_motion_date : null,
        notes ? sanitizeStr(truncateStr(notes,2000),2000) : null,
      ]
    );
    res.status(201).json({ created: true, id: r.lastID });
  } catch (e) {
    logger.error('[ability-to-pay POST]', e.message);
    res.status(500).json({ error: 'Could not create assessment.' });
  }
});

router.patch('/ability-to-pay/:id', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    const atpId = safeInt(req.params.id);
    if (!memb) return err403(res, 'Not a firm member.');
    const row = await db.get('SELECT id FROM ability_to_pay WHERE id=? AND firm_id=?', [atpId, memb.firm_id]);
    if (!row) return err404(res, 'Record not found.');

    const updates = [], params = [];
    const { bearden_motion_filed, bearden_motion_date, court_finding, alternative_ordered,
            genuinely_unable, can_pay_full, can_pay_partial, notes } = req.body || {};
    if (bearden_motion_filed !== undefined) { updates.push('bearden_motion_filed=?'); params.push(bearden_motion_filed?1:0); }
    if (bearden_motion_date && isValidDate(bearden_motion_date)) { updates.push('bearden_motion_date=?'); params.push(bearden_motion_date); }
    if (court_finding !== undefined) { updates.push('court_finding=?'); params.push(sanitizeStr(String(court_finding),50)); }
    if (alternative_ordered !== undefined) { updates.push('alternative_ordered=?'); params.push(sanitizeStr(String(alternative_ordered),100)); }
    if (genuinely_unable !== undefined) { updates.push('genuinely_unable=?'); params.push(genuinely_unable?1:0); }
    if (can_pay_full !== undefined) { updates.push('can_pay_full=?'); params.push(can_pay_full?1:0); }
    if (can_pay_partial !== undefined) { updates.push('can_pay_partial=?'); params.push(can_pay_partial?1:0); }
    if (notes !== undefined) { updates.push('notes=?'); params.push(notes ? sanitizeStr(truncateStr(notes,2000),2000) : null); }
    if (!updates.length) return err400(res, 'No fields to update.');
    updates.push("updated_at=datetime('now')");
    params.push(atpId);
    await db.run(`UPDATE ability_to_pay SET ${updates.join(',')} WHERE id=?`, params);
    res.json({ updated: true });
  } catch (e) {
    logger.error('[ability-to-pay PATCH]', e.message);
    res.status(500).json({ error: 'Could not update assessment.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// HAGUE PROCEEDINGS — International Child Abduction
// 1-year deadline for return petitions under the Hague Convention.
// ══════════════════════════════════════════════════════════════════════════════

router.get('/hague', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const limit  = Math.min(safeInt(req.query.limit, 50), 200);
    const offset = safeInt(req.query.offset, 0);

    const rows = await db.all(
      `SELECT hp.*, CAST(julianday('now') - julianday(hp.removal_date) AS INTEGER) as days_since_removal
       FROM hague_proceedings hp
       WHERE hp.firm_id=?
       ORDER BY hp.removal_date ASC
       LIMIT ? OFFSET ?`,
      [memb.firm_id, limit, offset]
    ).catch(() => []);

    const today = new Date();
    const enriched = rows.map(r => {
      const removal   = new Date(r.removal_date);
      const deadline  = new Date(removal); deadline.setFullYear(deadline.getFullYear() + 1);
      const daysLeft  = Math.ceil((deadline - today) / 86400000);
      return {
        ...r,
        one_year_deadline:    deadline.toISOString().slice(0, 10),
        within_one_year:      daysLeft > 0 ? 1 : 0,
        days_until_deadline:  daysLeft,
        settled_defense_risk: daysLeft <= 0 ? 1 : 0,
        deadline_critical:    daysLeft >= 0 && daysLeft <= 30,
      };
    });

    res.json({ proceedings: enriched, total: enriched.length, limit, offset });
  } catch (e) {
    logger.error('[hague GET]', e.message);
    res.status(500).json({ error: 'Could not load Hague proceedings.' });
  }
});

router.post('/hague', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const {
      matter_id, child_name, child_dob, taking_parent, left_behind_parent,
      removal_date, removal_country, habitual_residence,
      grave_risk_defense = 0, child_objection = 0, human_rights_defense = 0,
      central_authority_contacted = 0, notes,
    } = req.body || {};

    if (!child_name?.trim())          return err400(res, 'child_name required.');
    if (!removal_date)                return err400(res, 'removal_date required.');
    if (!isValidDate(removal_date))   return err400(res, 'removal_date must be YYYY-MM-DD.');
    if (!removal_country?.trim())     return err400(res, 'removal_country required.');
    if (!habitual_residence?.trim())  return err400(res, 'habitual_residence required.');

    const matterErr = await validateMatterId(db, matter_id, memb.firm_id, res);
    if (matterErr) return;

    // Calculate 1-year deadline
    const removalDate  = new Date(removal_date);
    const oneYearDeadline = new Date(removalDate);
    oneYearDeadline.setFullYear(oneYearDeadline.getFullYear() + 1);
    const deadlineStr  = oneYearDeadline.toISOString().slice(0, 10);
    const withinOneYear = new Date() < oneYearDeadline ? 1 : 0;

    const r = await db.run(
      `INSERT INTO hague_proceedings
         (matter_id, firm_id, created_by, child_name, child_dob, taking_parent, left_behind_parent,
          removal_date, removal_country, habitual_residence, one_year_deadline, within_one_year,
          settled_defense_risk, grave_risk_defense, child_objection, human_rights_defense,
          central_authority_contacted, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        matter_id ? safeInt(matter_id) : null, memb.firm_id, req.user.id,
        sanitizeStr(truncateStr(child_name,200),200),
        child_dob && isValidDate(child_dob) ? child_dob : null,
        taking_parent     ? sanitizeStr(truncateStr(taking_parent,200),200)     : null,
        left_behind_parent? sanitizeStr(truncateStr(left_behind_parent,200),200): null,
        removal_date, sanitizeStr(truncateStr(removal_country,100),100),
        sanitizeStr(truncateStr(habitual_residence,100),100),
        deadlineStr, withinOneYear, withinOneYear ? 0 : 1,
        grave_risk_defense?1:0, child_objection?1:0, human_rights_defense?1:0,
        central_authority_contacted?1:0,
        notes ? sanitizeStr(truncateStr(notes,2000),2000) : null,
      ]
    );
    res.status(201).json({ created: true, id: r.lastID, one_year_deadline: deadlineStr, within_one_year: withinOneYear });
  } catch (e) {
    logger.error('[hague POST]', e.message);
    res.status(500).json({ error: 'Could not create Hague proceeding.' });
  }
});

router.patch('/hague/:id', authRequired, routeLimiter, async (req, res) => {
  try {
    const db     = await getDb();
    const memb   = await getFirmMembership(db, req.user.id);
    const hagId  = safeInt(req.params.id);
    if (!memb) return err403(res, 'Not a firm member.');
    const row = await db.get('SELECT id FROM hague_proceedings WHERE id=? AND firm_id=?', [hagId, memb.firm_id]);
    if (!row) return err404(res, 'Proceeding not found.');

    const VALID_STATUS = ['pending','petition_filed','return_ordered','return_denied','child_returned','settled'];
    const updates = [], params = [];
    const { status, petition_filed, petition_date, petition_country,
            grave_risk_defense, child_objection, settled_defense_risk, notes } = req.body || {};
    if (status !== undefined) { if (!VALID_STATUS.includes(status)) return err400(res, `status must be one of: ${VALID_STATUS.join(', ')}.`); updates.push('status=?'); params.push(status); }
    if (petition_filed !== undefined) { updates.push('petition_filed=?'); params.push(petition_filed?1:0); }
    if (petition_date && isValidDate(petition_date)) { updates.push('petition_date=?'); params.push(petition_date); }
    if (petition_country !== undefined) { updates.push('petition_country=?'); params.push(petition_country ? sanitizeStr(petition_country,100) : null); }
    if (grave_risk_defense !== undefined) { updates.push('grave_risk_defense=?'); params.push(grave_risk_defense?1:0); }
    if (child_objection !== undefined) { updates.push('child_objection=?'); params.push(child_objection?1:0); }
    if (settled_defense_risk !== undefined) { updates.push('settled_defense_risk=?'); params.push(settled_defense_risk?1:0); }
    if (notes !== undefined) { updates.push('notes=?'); params.push(notes ? sanitizeStr(truncateStr(notes,2000),2000) : null); }
    if (!updates.length) return err400(res, 'No fields to update.');
    updates.push("updated_at=datetime('now')");
    params.push(hagId);
    await db.run(`UPDATE hague_proceedings SET ${updates.join(',')} WHERE id=?`, params);
    res.json({ updated: true });
  } catch (e) {
    logger.error('[hague PATCH]', e.message);
    res.status(500).json({ error: 'Could not update proceeding.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// MATERIAL SUPPORT SCREENING — 8 U.S.C. § 1182(a)(3)(B)
// Must be screened at asylum intake. Even duress-based support can bar asylum.
// ══════════════════════════════════════════════════════════════════════════════

router.get('/material-support', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const matterId = req.query.matter_id ? safeInt(req.query.matter_id) : null;
    let sql = 'SELECT * FROM material_support_screening WHERE firm_id=?'; /* intentional: full record for vertical UI */
    const args = [memb.firm_id];
    if (matterId) { sql += ' AND matter_id=?'; args.push(matterId); }
    sql += ' ORDER BY screening_date DESC LIMIT 100';

    const rows = await db.all(sql, args).catch(() => []);
    res.json({ screenings: rows, total: rows.length });
  } catch (e) {
    logger.error('[material-support GET]', e.message);
    res.status(500).json({ error: 'Could not load material support screenings.' });
  }
});

router.post('/material-support', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const {
      matter_id, client_name, screening_date,
      provided_money=0, provided_food=0, provided_shelter=0,
      provided_transportation=0, provided_communications=0, provided_weapons=0, provided_other,
      under_duress=0, duress_description, organization_type, organization_name,
      bar_potentially_applicable=0, duress_exception_available=0,
      de_minimis_argument_available=0, exemption_sought=0,
      referred_to_specialist=0, notes,
    } = req.body || {};

    if (!client_name?.trim())          return err400(res, 'client_name required.');
    if (!screening_date)               return err400(res, 'screening_date required.');
    if (!isValidDate(screening_date))  return err400(res, 'screening_date must be YYYY-MM-DD.');

    const VALID_ORG = ['cartel','insurgent','government','militia','other'];
    if (organization_type && !VALID_ORG.includes(organization_type)) return err400(res, `organization_type must be one of: ${VALID_ORG.join(', ')}.`);

    const matterErr = await validateMatterId(db, matter_id, memb.firm_id, res);
    if (matterErr) return;

    const r = await db.run(
      `INSERT INTO material_support_screening
         (matter_id, firm_id, screened_by, client_name, screening_date,
          provided_money, provided_food, provided_shelter, provided_transportation,
          provided_communications, provided_weapons, provided_other,
          under_duress, duress_description, organization_type, organization_name,
          bar_potentially_applicable, duress_exception_available,
          de_minimis_argument_available, exemption_sought, referred_to_specialist, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        matter_id ? safeInt(matter_id) : null, memb.firm_id, req.user.id,
        sanitizeStr(truncateStr(client_name,200),200), screening_date,
        provided_money?1:0, provided_food?1:0, provided_shelter?1:0,
        provided_transportation?1:0, provided_communications?1:0, provided_weapons?1:0,
        provided_other ? sanitizeStr(truncateStr(provided_other,500),500) : null,
        under_duress?1:0,
        duress_description ? sanitizeStr(truncateStr(duress_description,1000),1000) : null,
        organization_type || null,
        organization_name ? sanitizeStr(truncateStr(organization_name,200),200) : null,
        bar_potentially_applicable?1:0, duress_exception_available?1:0,
        de_minimis_argument_available?1:0, exemption_sought?1:0, referred_to_specialist?1:0,
        notes ? sanitizeStr(truncateStr(notes,2000),2000) : null,
      ]
    );
    res.status(201).json({ created: true, id: r.lastID });
  } catch (e) {
    logger.error('[material-support POST]', e.message);
    res.status(500).json({ error: 'Could not create material support screening.' });
  }
});

router.patch('/material-support/:id', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    const msId = safeInt(req.params.id);
    if (!memb) return err403(res, 'Not a firm member.');
    const row = await db.get('SELECT id FROM material_support_screening WHERE id=? AND firm_id=?', [msId, memb.firm_id]);
    if (!row) return err404(res, 'Screening record not found.');

    const updates = [], params = [];
    const { bar_finding, referred_to_specialist, exemption_sought, notes } = req.body || {};
    const VALID_FINDINGS = ['no_bar','bar_applies','bar_waived','under_review'];
    if (bar_finding !== undefined) { if (bar_finding && !VALID_FINDINGS.includes(bar_finding)) return err400(res, `bar_finding must be one of: ${VALID_FINDINGS.join(', ')}.`); updates.push('bar_finding=?'); params.push(bar_finding||null); }
    if (referred_to_specialist !== undefined) { updates.push('referred_to_specialist=?'); params.push(referred_to_specialist?1:0); }
    if (exemption_sought !== undefined) { updates.push('exemption_sought=?'); params.push(exemption_sought?1:0); }
    if (notes !== undefined) { updates.push('notes=?'); params.push(notes ? sanitizeStr(truncateStr(notes,2000),2000) : null); }
    if (!updates.length) return err400(res, 'No fields to update.');
    params.push(msId);
    await db.run(`UPDATE material_support_screening SET ${updates.join(',')} WHERE id=?`, params);
    res.json({ updated: true });
  } catch (e) {
    logger.error('[material-support PATCH]', e.message);
    res.status(500).json({ error: 'Could not update screening.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// DUAL SOVEREIGNTY FLAGS
// Tracks federal parallel prosecution risk after state proceedings.
// Double jeopardy does NOT bar successive state+federal prosecution.
// ══════════════════════════════════════════════════════════════════════════════

router.get('/dual-sovereignty', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const matterId = req.query.matter_id ? safeInt(req.query.matter_id) : null;
    let sql = 'SELECT * FROM dual_sovereignty_flags WHERE firm_id=?'; /* intentional: full record for vertical UI */
    const args = [memb.firm_id];
    if (matterId) { sql += ' AND matter_id=?'; args.push(matterId); }
    sql += ' ORDER BY flagged_at DESC LIMIT 100';

    const rows = await db.all(sql, args).catch(() => []);
    res.json({ flags: rows, total: rows.length });
  } catch (e) {
    logger.error('[dual-sovereignty GET]', e.message);
    res.status(500).json({ error: 'Could not load dual sovereignty flags.' });
  }
});

router.post('/dual-sovereignty', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const {
      matter_id, federal_nexus, state_case_status = 'pending',
      federal_investigation_known = 0, federal_agency, risk_level = 'unknown',
      petite_policy_applicable = 0, petite_policy_waiver_risk = 0, notes,
    } = req.body || {};

    if (!matter_id) return err400(res, 'matter_id required.');

    const VALID_STATE_STATUS = ['pending','acquitted','convicted','dismissed','no_charge'];
    const VALID_RISK = ['low','moderate','high','critical','unknown'];
    if (!VALID_STATE_STATUS.includes(state_case_status)) return err400(res, `state_case_status must be one of: ${VALID_STATE_STATUS.join(', ')}.`);
    if (!VALID_RISK.includes(risk_level)) return err400(res, `risk_level must be one of: ${VALID_RISK.join(', ')}.`);

    const matterErr = await validateMatterId(db, matter_id, memb.firm_id, res);
    if (matterErr) return;

    const VALID_NEXUS = ['interstate_commerce','federal_land','federal_employee','bank','mail','wire','drug','immigration','firearms'];
    if (federal_nexus && !VALID_NEXUS.includes(federal_nexus)) return err400(res, `federal_nexus must be one of: ${VALID_NEXUS.join(', ')}.`);

    const r = await db.run(
      `INSERT INTO dual_sovereignty_flags
         (matter_id, firm_id, created_by, federal_nexus, state_case_status,
          federal_investigation_known, federal_agency, risk_level,
          petite_policy_applicable, petite_policy_waiver_risk, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        safeInt(matter_id), memb.firm_id, req.user.id,
        federal_nexus || null, state_case_status,
        federal_investigation_known?1:0,
        federal_agency ? sanitizeStr(federal_agency,50) : null,
        risk_level, petite_policy_applicable?1:0, petite_policy_waiver_risk?1:0,
        notes ? sanitizeStr(truncateStr(notes,2000),2000) : null,
      ]
    );

    // Update matter flag
    await db.run("UPDATE matters SET dual_sovereignty_risk=1, updated_at=datetime('now') WHERE id=?", [safeInt(matter_id)]).catch(() => {});

    res.status(201).json({ created: true, id: r.lastID });
  } catch (e) {
    logger.error('[dual-sovereignty POST]', e.message);
    res.status(500).json({ error: 'Could not create dual sovereignty flag.' });
  }
});

router.patch('/dual-sovereignty/:id', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    const dsId = safeInt(req.params.id);
    if (!memb) return err403(res, 'Not a firm member.');
    const row = await db.get('SELECT id FROM dual_sovereignty_flags WHERE id=? AND firm_id=?', [dsId, memb.firm_id]);
    if (!row) return err404(res, 'Flag not found.');

    const VALID_RISK = ['low','moderate','high','critical','unknown'];
    const updates = [], params = [];
    const { state_case_status, federal_investigation_known, risk_level, federal_agency, notes } = req.body || {};
    if (state_case_status !== undefined) { updates.push('state_case_status=?'); params.push(sanitizeStr(state_case_status,30)); }
    if (federal_investigation_known !== undefined) { updates.push('federal_investigation_known=?'); params.push(federal_investigation_known?1:0); }
    if (risk_level !== undefined) { if (!VALID_RISK.includes(risk_level)) return err400(res, `Invalid risk_level.`); updates.push('risk_level=?'); params.push(risk_level); }
    if (federal_agency !== undefined) { updates.push('federal_agency=?'); params.push(federal_agency ? sanitizeStr(federal_agency,50) : null); }
    if (notes !== undefined) { updates.push('notes=?'); params.push(notes ? sanitizeStr(truncateStr(notes,2000),2000) : null); }
    if (!updates.length) return err400(res, 'No fields to update.');
    updates.push("updated_at=datetime('now')");
    params.push(dsId);
    await db.run(`UPDATE dual_sovereignty_flags SET ${updates.join(',')} WHERE id=?`, params);
    res.json({ updated: true });
  } catch (e) {
    logger.error('[dual-sovereignty PATCH]', e.message);
    res.status(500).json({ error: 'Could not update flag.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// EVICTION TRACKERS
// Eviction = homelessness when missed. Some of the shortest deadlines in law.
// ══════════════════════════════════════════════════════════════════════════════

const VALID_EVICTION_STATUS = ['pending','answer_filed','hearing_set','judgment_landlord','judgment_tenant','dismissed','settled'];
const VALID_NOTICE_TYPE = ['pay_or_quit','cure_or_quit','unconditional_quit','no_fault'];

router.get('/eviction', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const limit  = Math.min(safeInt(req.query.limit, 50), 200);
    const offset = safeInt(req.query.offset, 0);
    const status = req.query.status ? sanitizeStr(req.query.status, 30) : null;

    let sql = 'SELECT * FROM eviction_trackers WHERE firm_id=?'; /* intentional: full record for vertical UI */
    const args = [memb.firm_id];
    if (status) { sql += ' AND status=?'; args.push(status); }
    sql += ' ORDER BY answer_deadline ASC NULLS LAST, created_at DESC LIMIT ? OFFSET ?';
    args.push(limit, offset);

    const rows = await db.all(sql, args).catch(() => []);
    const today = new Date();
    const enriched = rows.map(r => {
      let days_until_answer = null, answer_critical = false;
      if (r.answer_deadline && r.status === 'pending') {
        days_until_answer = Math.ceil((new Date(r.answer_deadline) - today) / 86400000);
        answer_critical   = days_until_answer >= 0 && days_until_answer <= 3;
      }
      return { ...r, days_until_answer, answer_critical };
    });

    res.json({ trackers: enriched, total: enriched.length, limit, offset });
  } catch (e) {
    logger.error('[eviction GET]', e.message);
    res.status(500).json({ error: 'Could not load eviction trackers.' });
  }
});

router.post('/eviction', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    if (!memb) return err403(res, 'Not a firm member.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');

    const {
      matter_id, client_name, landlord_name, property_address, state,
      notice_type, notice_date, notice_period_days,
      summons_served_date, answer_deadline, hearing_date,
      right_to_cure_deadline, rent_owed_cents = 0, rent_paid_cents = 0,
      emergency_stay_filed = 0, hardship_protection_claimed = 0, defenses, notes,
    } = req.body || {};

    if (!client_name?.trim()) return err400(res, 'client_name required.');
    if (!state?.trim())       return err400(res, 'state required.');
    if (answer_deadline && !isValidDate(answer_deadline)) return err400(res, 'answer_deadline must be YYYY-MM-DD.');
    if (hearing_date   && !isValidDate(hearing_date))    return err400(res, 'hearing_date must be YYYY-MM-DD.');
    if (notice_type    && !VALID_NOTICE_TYPE.includes(notice_type)) return err400(res, `notice_type must be one of: ${VALID_NOTICE_TYPE.join(', ')}.`);

    const matterErr = await validateMatterId(db, matter_id, memb.firm_id, res);
    if (matterErr) return;

    const r = await db.run(
      `INSERT INTO eviction_trackers
         (matter_id, firm_id, created_by, client_name, landlord_name, property_address, state,
          notice_type, notice_date, notice_period_days, summons_served_date, answer_deadline,
          hearing_date, right_to_cure_deadline, rent_owed_cents, rent_paid_cents,
          emergency_stay_filed, hardship_protection_claimed, defenses, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        matter_id ? safeInt(matter_id) : null, memb.firm_id, req.user.id,
        sanitizeStr(truncateStr(client_name,200),200),
        landlord_name     ? sanitizeStr(truncateStr(landlord_name,200),200)    : null,
        property_address  ? sanitizeStr(truncateStr(property_address,500),500) : null,
        sanitizeStr(state.toUpperCase().slice(0,5), 5),
        notice_type || null,
        notice_date && isValidDate(notice_date) ? notice_date : null,
        notice_period_days ? safeInt(notice_period_days) : null,
        summons_served_date && isValidDate(summons_served_date) ? summons_served_date : null,
        answer_deadline || null, hearing_date || null,
        right_to_cure_deadline && isValidDate(right_to_cure_deadline) ? right_to_cure_deadline : null,
        safeInt(rent_owed_cents,0), safeInt(rent_paid_cents,0),
        emergency_stay_filed?1:0, hardship_protection_claimed?1:0,
        defenses ? sanitizeStr(truncateStr(defenses,500),500) : null,
        notes    ? sanitizeStr(truncateStr(notes,2000),2000)   : null,
      ]
    );
    res.status(201).json({ created: true, id: r.lastID });
  } catch (e) {
    logger.error('[eviction POST]', e.message);
    res.status(500).json({ error: 'Could not create eviction tracker.' });
  }
});

router.patch('/eviction/:id', authRequired, routeLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getFirmMembership(db, req.user.id);
    const evId = safeInt(req.params.id);
    if (!memb) return err403(res, 'Not a firm member.');
    const row = await db.get('SELECT id FROM eviction_trackers WHERE id=? AND firm_id=?', [evId, memb.firm_id]);
    if (!row) return err404(res, 'Eviction tracker not found.');

    const updates = [], params = [];
    const {
      status, answer_deadline, hearing_date, emergency_stay_filed,
      stay_granted, stay_duration_days, cure_exercised,
      rent_paid_cents, defenses, notes,
    } = req.body || {};

    if (status !== undefined) { if (!VALID_EVICTION_STATUS.includes(status)) return err400(res, `Invalid status.`); updates.push('status=?'); params.push(status); }
    if (answer_deadline && isValidDate(answer_deadline)) { updates.push('answer_deadline=?'); params.push(answer_deadline); }
    if (hearing_date    && isValidDate(hearing_date))    { updates.push('hearing_date=?');    params.push(hearing_date); }
    if (emergency_stay_filed !== undefined) { updates.push('emergency_stay_filed=?'); params.push(emergency_stay_filed?1:0); }
    if (stay_granted    !== undefined) { updates.push('stay_granted=?');    params.push(stay_granted?1:0); }
    if (stay_duration_days !== undefined) { updates.push('stay_duration_days=?'); params.push(safeInt(stay_duration_days,0)); }
    if (cure_exercised  !== undefined) { updates.push('cure_exercised=?');  params.push(cure_exercised?1:0); }
    if (rent_paid_cents !== undefined) { updates.push('rent_paid_cents=?'); params.push(safeInt(rent_paid_cents,0)); }
    if (defenses !== undefined) { updates.push('defenses=?'); params.push(defenses ? sanitizeStr(truncateStr(defenses,500),500) : null); }
    if (notes    !== undefined) { updates.push('notes=?');    params.push(notes    ? sanitizeStr(truncateStr(notes,2000),2000)   : null); }
    if (!updates.length) return err400(res, 'No fields to update.');
    updates.push("updated_at=datetime('now')");
    params.push(evId);
    await db.run(`UPDATE eviction_trackers SET ${updates.join(',')} WHERE id=?`, params);
    res.json({ updated: true });
  } catch (e) {
    logger.error('[eviction PATCH]', e.message);
    res.status(500).json({ error: 'Could not update eviction tracker.' });
  }
});


export default router;

// PATCH /api/firm-verticals/:firmId/:trackerId/resolve
router.patch('/:firmId/:trackerId/resolve', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const { firmId, trackerId } = req.params;
    const { resolved, resolution_notes } = req.body || {};
    // Try to update in any tracker table
    const ALLOWED_TRACKER_TABLES = new Set(['plea_offers','voluntary_departure','vop_trackers','bop_exhaustion','padilla_warnings']);
    let updated = false;
    for (const table of ALLOWED_TRACKER_TABLES) {
      // table comes from a hard-coded Set — never from user input, no SQLi risk
      // eslint-disable-next-line no-await-in-loop
      try {
        const r = await db.run(
          `UPDATE ${table} SET status = ?, resolution_notes = ?, updated_at = datetime('now')
           WHERE id = ? AND firm_id = ?`,
          [resolved ? 'resolved' : 'pending', resolution_notes || null, trackerId, firmId]
        );
        if (r.changes > 0) { updated = true; break; }
      } catch {}
    }
    res.json({ resolved: updated, tracker_id: trackerId });
  } catch(e) { res.status(500).json({ error: 'Internal server error.', code: 'server_error' }); }
});
