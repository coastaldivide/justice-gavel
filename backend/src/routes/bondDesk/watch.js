/**
 * routes/bondDesk/watch.js — re-arrest alerts (A4, ⚖ BOND_REARREST_ALERTS_ENABLED), the bond
 * timeline, and sharing a forfeited bond with a recovery agent (B4, ⚖ BOND_RECOVERY_SHARING_ENABLED).
 * Mounted at /api/bond-desk (bail agent with a plan). docs/BOND_DESK.md.
 *
 *   GET  /bonds/:id/rearrests            coverage (the rosters we import) + this bond's matches
 *   POST /rearrests/:id/confirm|dismiss  decide a possible (name-only) match
 *   GET  /rearrest-settings              the agent's "text me too" choice
 *   PUT  /rearrest-settings              { rearrest_text, alert_phone? }
 *   GET  /bonds/:id/timeline             the bond's events (re-arrests, sharing)
 *   GET  /bonds/:id/recovery             the state's recovery-agent rule + shares + every view
 *   POST /bonds/:id/recovery/shares      { email, share_locations, rule_acknowledged: true }
 *   POST /recovery/shares/:id/revoke
 * With the setting off: 503 { code: 'feature_unavailable' }.
 */
import { Router } from 'express';
import { BdError, fail, handle, id, email, phone, body } from './_common.js';
import { loadBond } from './bonds.js';
import { rearrestAlertsEnabled, recoverySharingEnabled } from '../../utils/counselFlags.js';
import { bondRearrests, coverage, decide } from '../../services/bondDesk/rearrest.js';
import { createShare, revokeShare, sharesForBond, stateRule, ShareError } from '../../services/bondDesk/recoveryShares.js';
import { AGENT_TEXT_CENTS } from '../billing/plans.js';
import { resolveLang } from '../../i18n/index.js';

const router = Router();

const gate = (on) => (req, res, next) => (on() ? next() : fail(req, res, new BdError(503, 'feature_unavailable')));
const rearrestOn = gate(() => rearrestAlertsEnabled());
const recoveryOn = gate(() => recoverySharingEnabled());
const asBd = (e) => (e instanceof ShareError ? new BdError(e.status, e.code, e.params) : e);

// ── Re-arrest alerts ──────────────────────────────────────────────────────────

async function settings(db, agentId) {
  const s = await db.get('SELECT rearrest_text, alert_phone FROM bd_alert_settings WHERE agent_id = ?', [agentId]);
  return { rearrest_text: !!s?.rearrest_text, alert_phone: s?.alert_phone || null };
}

router.get('/bonds/:id/rearrests', rearrestOn, handle(async (req, res, db) => {
  const bond = await loadBond(db, req.agentId, id(req.params.id));
  res.json({
    coverage: await coverage(db),
    watching: ['active', 'forfeited'].includes(bond.status),
    dob_on_file: !!bond.defendant_dob,
    matches: await bondRearrests(db, bond.id),
    settings: await settings(db, req.agentId),
    text_cents: AGENT_TEXT_CENTS,
  });
}));

for (const decision of ['confirm', 'dismiss']) {
  router.post(`/rearrests/:id/${decision}`, rearrestOn, handle(async (req, res, db) => {
    const rid = id(req.params.id);
    const done = await decide(db, req.agentId, rid, decision);
    if (!done) {
      const r = await db.get('SELECT status FROM bd_rearrests WHERE id = ? AND agent_id = ?', [rid, req.agentId]);
      throw r ? new BdError(409, 'already_decided') : new BdError(404, 'not_found');
    }
    res.json({ ok: true, status: decision === 'confirm' ? 'confirmed' : 'dismissed' });
  }));
}

router.get('/rearrest-settings', rearrestOn, handle(async (req, res, db) => {
  res.json({ settings: await settings(db, req.agentId), text_cents: AGENT_TEXT_CENTS });
}));

router.put('/rearrest-settings', rearrestOn, handle(async (req, res, db) => {
  const b = body(req);
  if (typeof b.rearrest_text !== 'boolean') throw new BdError(400, 'invalid', { field: 'rearrest_text' });
  const p = phone(b.alert_phone, 'alert_phone');
  if (b.rearrest_text && !p) {
    const prof = await db.get('SELECT phone FROM bondsman_profiles WHERE user_id = ?', [req.agentId]);
    if (!prof?.phone) throw new BdError(400, 'required', { field: 'alert_phone' });
  }
  await db.run(
    `INSERT INTO bd_alert_settings (agent_id, rearrest_text, alert_phone, updated_at) VALUES (?, ?, ?, NOW())
     ON CONFLICT (agent_id) DO UPDATE SET rearrest_text = EXCLUDED.rearrest_text, alert_phone = EXCLUDED.alert_phone, updated_at = NOW()`,
    [req.agentId, b.rearrest_text, p]);
  res.json({ settings: await settings(db, req.agentId) });
}));

// ── Timeline ──────────────────────────────────────────────────────────────────

router.get('/bonds/:id/timeline', handle(async (req, res, db) => {
  const bond = await loadBond(db, req.agentId, id(req.params.id));
  const rows = await db.all('SELECT id, kind, detail, created_at FROM bd_bond_events WHERE bond_id = ? ORDER BY created_at DESC, id DESC LIMIT 100', [bond.id]);
  res.json({ events: rows.map((r) => ({ id: Number(r.id), kind: r.kind, detail: r.detail || {}, at: r.created_at })) });
}));

// ── Recovery-agent sharing ────────────────────────────────────────────────────

router.get('/bonds/:id/recovery', recoveryOn, handle(async (req, res, db) => {
  const bond = await loadBond(db, req.agentId, id(req.params.id));
  res.json({ bond_status: bond.status, state: bond.state || null, state_rule: stateRule(bond.state), shares: await sharesForBond(db, bond.id) });
}));

router.post('/bonds/:id/recovery/shares', recoveryOn, handle(async (req, res, db) => {
  const bond = await loadBond(db, req.agentId, id(req.params.id));
  const b = body(req);
  const to = email(b.email, 'email');
  if (!to) throw new BdError(400, 'required', { field: 'email' });
  try {
    const out = await createShare(db, { agentId: req.agentId, bond, email: to, shareLocations: b.share_locations === true,
      ruleAcknowledged: b.rule_acknowledged, lang: resolveLang(req) });
    res.status(201).json({ share: { id: out.id }, email_status: out.email_status, link: out.link, shares: await sharesForBond(db, bond.id) });
  } catch (e) { throw asBd(e); }
}));

router.post('/recovery/shares/:id/revoke', recoveryOn, handle(async (req, res, db) => {
  try { await revokeShare(db, req.agentId, id(req.params.id)); } catch (e) { throw asBd(e); }
  res.json({ ok: true });
}));

export default router;
