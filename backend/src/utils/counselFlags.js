/**
 * utils/counselFlags.js — features that are built and tested but wait for a counsel answer
 * (⚖ in docs/BUILD_PLAN_COMPETITOR_FEATURES.md). Each sits behind its own setting:
 *
 *   explicit true / 1   → on
 *   explicit false / 0  → off
 *   unset               → OFF in production (APP_ENV or NODE_ENV = production), on elsewhere
 *
 * Off: the routes answer 503 { code: 'feature_unavailable' }, the jobs do nothing for that
 * feature, and GET /api/bond-desk/access (and /api/custody/status) tell the app to hide it.
 * scripts/check-env.js (backend/scripts/lib/envReport.mjs) warns when one is on in production.
 */
export const COUNSEL_FLAGS = Object.freeze({
  BOND_REARREST_ALERTS_ENABLED: '1.2 re-arrest alerts for an agent\'s own defendants',
  CUSTODY_ALERTS_ENABLED: '6.3 release / transfer alerts for families',
  BOND_RECOVERY_SHARING_ENABLED: 'state recovery-agent rules (sharing a forfeited bond with a recovery agent)',
});

/** Explicit true/false wins; unset → off in production, on elsewhere. */
export function counselFlagOn(name, env = process.env) {
  const v = String(env[name] ?? '').trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return String(env.APP_ENV || '').toLowerCase() !== 'production' && String(env.NODE_ENV || '').toLowerCase() !== 'production';
}

// Each reads its variable by name (so scripts/check-env and the env-docs test see it).
const pick = (env, name, value) => (env ? env : { [name]: value, APP_ENV: process.env.APP_ENV, NODE_ENV: process.env.NODE_ENV });
export const rearrestAlertsEnabled = (env) => counselFlagOn('BOND_REARREST_ALERTS_ENABLED', pick(env, 'BOND_REARREST_ALERTS_ENABLED', process.env.BOND_REARREST_ALERTS_ENABLED));
export const custodyAlertsEnabled = (env) => counselFlagOn('CUSTODY_ALERTS_ENABLED', pick(env, 'CUSTODY_ALERTS_ENABLED', process.env.CUSTODY_ALERTS_ENABLED));
export const recoverySharingEnabled = (env) => counselFlagOn('BOND_RECOVERY_SHARING_ENABLED', pick(env, 'BOND_RECOVERY_SHARING_ENABLED', process.env.BOND_RECOVERY_SHARING_ENABLED));
