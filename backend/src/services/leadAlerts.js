/**
 * services/leadAlerts.js — new-arrest alerts for bail agents on a paid plan.
 *
 * Bail-agent plans (routes/billing/plans.js BONDSMAN_TIERS) cover the first
 * `counties` counties saved on the agent's profile (Market: every county in the
 * agent's states). After each ingest run (services/arrest_alerts.js) every new
 * real arrest record with bail set and no attorney of record in a covered county
 * sends that agent one push (a summary per run), at most once per record
 * (lead_alert_log), in the agent's language, unless arrest alerts are off.
 * The push carries counts and the county only — the record itself is bought.
 */
import { BONDSMAN_TIERS, ALL_COUNTIES } from '../routes/billing/plans.js';
import { PAID_STATUSES } from './entitlements.js';
import { sendPushToUser } from './pushDelivery.js';
import { msg, userLang } from '../i18n/index.js';
import { logIgnored } from '../utils/ignored.js';

const parseList = (v) => { try { const p = JSON.parse(v || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } };
const norm = (s) => String(s || '').replace(/\s+county$/i, '').trim().toLowerCase();

/** The arrests an agent's plan covers. */
export function coveredArrests(agent, arrests) {
  const tier = BONDSMAN_TIERS[agent.tier];
  if (!tier) return [];
  const states = parseList(agent.states).map(s => String(s).toUpperCase());
  const inState = (a) => !states.length || states.includes(String(a.state || '').toUpperCase());
  if (tier.counties >= ALL_COUNTIES) return arrests.filter(inState);
  const counties = parseList(agent.counties).slice(0, tier.counties).map(norm).filter(Boolean);
  return arrests.filter(a => inState(a) && counties.includes(norm(a.county)));
}

export async function notifyCoveredBondsmen(db, arrests, { dryRun = false } = {}) {
  const leads = arrests.filter(a => Number(a.bail_amount) > 0 && !Number(a.has_attorney));
  if (!leads.length) return { bondsman_alerts: 0 };
  const agents = await db.all(
    `SELECT bs.user_id, bs.tier, bp.counties, bp.states, COALESCE(u.notif_arrest_alerts, 1) AS alerts_on
       FROM bondsman_subscriptions bs
       JOIN bondsman_profiles bp ON bp.user_id = bs.user_id
       JOIN users u ON u.id = bs.user_id
      WHERE bs.status IN (${PAID_STATUSES.map(s => `'${s}'`).join(',')})`);
  let sent = 0;
  for (const agent of agents) {
    if (Number(agent.alerts_on) !== 1) continue;
    const mine = coveredArrests(agent, leads);
    if (!mine.length || dryRun) continue;
    const fresh = [];
    for (const a of mine) {
      const r = await db.run('INSERT INTO lead_alert_log (user_id, arrest_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [agent.user_id, a.id]);
      if (r.changes) fresh.push(a);
    }
    if (!fresh.length) continue;
    const lang = await userLang(db, agent.user_id).catch(() => 'en');
    const counties = [...new Set(fresh.map(a => a.county).filter(Boolean))];
    await sendPushToUser(Number(agent.user_id), {
      title: msg(lang, 'leads.push.new_title'),
      body: msg(lang, fresh.length === 1 ? 'leads.push.new_body_one' : 'leads.push.new_body_other', { n: fresh.length, counties: counties.slice(0, 3).join(', ') }),
      data: { type: 'new_lead', screen: 'BondsmanDashboard' },
      channelId: 'leads',
    }).catch(logIgnored('services/leadAlerts'));
    sent++;
  }
  return { bondsman_alerts: sent };
}
