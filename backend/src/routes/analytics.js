/**
 * JUSTICE GAVEL — ANALYTICS ROUTES v1.0.0
 * GET  /:matterId/estimate   — Full outcome estimate with factor analysis
 * GET  /:matterId/precedents — Applicable precedent citations
 * GET  /monitor/status       — Registry staleness (admin)
 * POST /monitor/run          — Trigger monitoring cycle (admin)
 * GET  /audit/bias           — Run bias audit (admin)
 * GET  /registry             — View registry entries (admin)
 */

import express from 'express';
import { computeOutcomeEstimate } from '../analytics/outcomeEstimator.js';
import { checkStaleness, runBiasAudit, run as runMonitor } from '../analytics/precedentMonitor.js';
import { PRECEDENT_REGISTRY, getRelevantEntries } from '../analytics/precedentRegistry.js';
import { getDb }              from '../db/index.js';
import { authRequired }       from '../middleware/auth.js';
// getFirmMembership — resolved via rbac middleware instead
import { hasMinRole }         from '../middleware/rbac.js';
import logger                 from '../utils/logger.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';

const routeLimiter = makeUserLimiter(30, 60_000); // 30 req/min per user


// ── Firm membership helper ────────────────────────────────────────────────────
async function getFirmMembership(db, userId) {
  try {
    return await db.get(
      "SELECT * FROM firm_members WHERE user_id=? AND status='active' LIMIT 1",
      [userId]
    );
  } catch { return null; }
}

const router = express.Router();

const err403 = (res, msg) => res.status(403).json({ error: msg });
const err404 = (res, msg) => res.status(404).json({ error: msg });
const safeInt = (v, fb=0) => { const n=parseInt(v,10); return isNaN(n)?fb:n; };

async function loadMatter(db, matterId, userId) {
  const memb = await getFirmMembership(db, userId);
  if (!memb) return { error:'403', memb:null, matter:null };
  const m = await db.get(
    `SELECT m.id, m.firm_id, m.title, m.vertical, m.evidence_score,
            m.vulnerability_level, m.time_pressure, m.status, m.matter_taxonomy AS taxonomy,
            m.jurisdiction, m.prior_adjudications, m.prior_appeals,
            m.years_post_conviction, m.hab_track, m.is_capital,
            m.cooperation_level, m.dpa_status, m.damages_type,
            m.class_certification_status, m.asset_tier, m.dv_flag,
            m.clock_days, m.detained, m.country_condition, m.years_us,
            m.injury_severity, m.causation_type, m.plaintiff_fault_pct,
            m.economic_damages, m.noneconomic_damages, m.punitive_damages,
            m.policy_limit, m.service_years, m.rank_e, m.court_type,
            m.prior_njp, m.client_age, m.case_track, m.relief_type
     FROM matters m WHERE m.id=? AND m.firm_id=?`,
    [matterId, memb.firm_id]
  );
  if (!m) return { error:'404', memb, matter:null };
  return { error:null, memb, matter:m };
}

// GET /:matterId/estimate — Full factor-based outcome analysis
router.get('/:matterId/estimate', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const { error, memb, matter } = await loadMatter(db, req.params.matterId, req.user.id);
    if (error==='403') return err403(res, 'Not a firm member.');
    if (error==='404') return err404(res, 'Matter not found.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');
    const estimate = computeOutcomeEstimate(matter);
    logger.info('[analytics/estimate]', { matter_id:matter.id, firm_id:memb.firm_id, analyses:estimate.analyses.length });
    res.json(estimate);
  } catch(e) { logger.error('[analytics/estimate]', e.message); res.status(500).json({ error:'Could not compute estimate.' }); }
});

// GET /:matterId/precedents — Applicable citations for attorney research
router.get('/:matterId/precedents', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const { error, memb, matter } = await loadMatter(db, req.params.matterId, req.user.id);
    if (error==='403') return err403(res, 'Not a firm member.');
    if (error==='404') return err404(res, 'Matter not found.');
    if (!hasMinRole(memb.role, 'associate')) return err403(res, 'Requires associate+.');
    const asOf = new Date().toISOString().slice(0,10);
    const entries = getRelevantEntries(matter.vertical, matter.taxonomy, asOf);
    res.json({
      matter_id:matter.id, vertical:matter.vertical, taxonomy:matter.taxonomy, as_of:asOf,
      precedents:entries.map(e=>({ id:e.id, title:e.title, source:e.source, source_url:e.source_url,
        source_type:e.source_type, holding:e.holding, jurisdiction:e.jurisdiction,
        valid_from:e.valid_from, stale_after:e.stale_after, circuit_split:e.circuit_split,
        notes:e.notes, stat_base:e.stat_base, stat_year:e.stat_year, stat_n:e.stat_n })),
      total:entries.length, computed_at:new Date().toISOString(),
      disclaimer:'Verify currency and applicability independently before relying on any citation.',
    });
  } catch(e) { logger.error('[analytics/precedents]', e.message); res.status(500).json({ error:'Could not load precedents.' }); }
});

// GET /monitor/status — Registry staleness (admin)
router.get('/monitor/status', authRequired, async (req, res) => {
  try {
    const db=await getDb();
    let memb = null;
    try { memb = await getFirmMembership(db,req.user.id); } catch(dbE) { /* demo mode — no firm tables */ }
    if (memb && !hasMinRole(memb.role,'firm_admin')) return err403(res,'Requires firm_admin+.');
    res.json({ ...checkStaleness(), demo: !memb });
  } catch(e) { logger.warn('[analytics/monitor/status]',e.message); res.json({ status:'unavailable', demo:true }); }
});

// POST /monitor/run — Trigger monitoring cycle (admin)
router.post('/monitor/run', authRequired, routeLimiter, async (req, res) => {
  try {
    const db=await getDb(); const memb=await getFirmMembership(db,req.user.id);
    if (!memb) return err403(res,'Not a firm member.');
    if (!hasMinRole(memb.role,'firm_admin')) return err403(res,'Requires firm_admin+.');
    const { daysBack=90, skipCourtListener=false } = req.body||{};
    logger.info('[analytics/monitor/run]',{firm_id:memb.firm_id,daysBack,skipCourtListener});
    const report = await runMonitor({ daysBack:safeInt(daysBack,90), skipCourtListener:!!skipCourtListener });
    res.json(report);
  } catch(e) { logger.error('[analytics/monitor/run]',e.message); res.status(500).json({error:'Could not run monitor.'}); }
});

// GET /audit/bias — Run structural bias audit (admin)
router.get('/audit/bias', authRequired, async (req, res) => {
  try {
    const db=await getDb(); const memb=await getFirmMembership(db,req.user.id);
    if (!memb) return err403(res,'Not a firm member.');
    if (!hasMinRole(memb.role,'firm_admin')) return err403(res,'Requires firm_admin+.');
    const result = runBiasAudit(computeOutcomeEstimate);
    logger.info('[analytics/audit/bias]',{firm_id:memb.firm_id,all_passed:result.all_passed});
    res.json(result);
  } catch(e) { logger.error('[analytics/audit/bias]',e.message); res.status(500).json({error:'Could not run bias audit.'}); }
});

// GET /registry — View registry entries (admin)
router.get('/registry', authRequired, async (req, res) => {
  try {
    const db=await getDb(); const memb=await getFirmMembership(db,req.user.id);
    if (!memb) return err403(res,'Not a firm member.');
    if (!hasMinRole(memb.role,'firm_admin')) return err403(res,'Requires firm_admin+.');
    const { vertical, source_type, circuit_split } = req.query;
    let entries = PRECEDENT_REGISTRY;
    if (vertical)     entries = entries.filter(e=>e.vertical===vertical);
    if (source_type)  entries = entries.filter(e=>e.source_type===source_type);
    if (circuit_split==='true') entries = entries.filter(e=>e.circuit_split);
    res.json({
      total:entries.length, as_of:new Date().toISOString().slice(0,10),
      entries:entries.map(e=>({ id:e.id, vertical:e.vertical, title:e.title,
        source_type:e.source_type, jurisdiction:e.jurisdiction, stat_base:e.stat_base,
        stat_year:e.stat_year, valid_from:e.valid_from, stale_after:e.stale_after,
        superseded_by:e.superseded_by, circuit_split:e.circuit_split })),
    });
  } catch(e) { logger.error('[analytics/registry]',e.message); res.status(500).json({error:'Could not load registry.'}); }
});

export default router;
