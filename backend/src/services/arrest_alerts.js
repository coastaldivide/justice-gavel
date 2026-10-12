import logger from '../utils/logger.js';
/**
 * arrest_alerts.js — Attorney & Bail Agent Notification System
 * ─────────────────────────────────────────────────────────────
 * Queries new arrest records and notifies subscribed attorneys
 * and bail agents based on their practice area, geography, and
 * alert preferences.
 *
 * Alert types:
 *   - Attorney: "3 new DUI arrests in Davidson County — no attorney of record"
 *   - Bail agent: "5 new bookings in Davidson County — bail set $5k–$50k"
 *
 * Called by scheduler.js on a configurable cron (default: every 6 hours)
 * Can also be triggered via POST /api/admin/send-arrest-alerts
 */

import { getDb } from '../db/index.js';
import { realArrestSql } from '../utils/arrestVisibility.js';


// Charge keywords mapped to practice areas
const PRACTICE_AREA_KEYWORDS = {
  'DUI':           ['dui', 'dwi', 'drunk driving', 'driving under', 'driving while'],
  'Drug Offenses': ['drug', 'narcotics', 'controlled substance', 'possession', 'trafficking', 'cocaine', 'heroin', 'meth', 'marijuana', 'cannabis'],
  'Assault':       ['assault', 'battery', 'domestic', 'violence', 'aggravated'],
  'Theft':         ['theft', 'larceny', 'robbery', 'burglary', 'shoplifting', 'stolen'],
  'Murder':        ['murder', 'homicide', 'manslaughter', 'killing'],
  'Sex Offenses':  ['sexual', 'rape', 'indecent', 'exploitation'],
  'Weapons':       ['weapon', 'firearm', 'gun', 'knife', 'armed'],
  'Fraud':         ['fraud', 'forgery', 'identity theft', 'embezzlement', 'scam'],
  'Traffic':       ['traffic', 'reckless driving', 'speeding', 'license'],
  'Juvenile':      ['juvenile', 'minor', 'delinquency'],
};

function matchesPracticeArea(charges, practiceArea) {
  if (!charges) return false;
  const lower = charges.toLowerCase();
  const keywords = PRACTICE_AREA_KEYWORDS[practiceArea] || [practiceArea.toLowerCase()];
  return keywords.some(kw => lower.includes(kw));
}

// ── Format alert messages ─────────────────────────────────────────────────────
function buildAttorneyAlert(attorney, arrests) {
  const byArea = {};
  for (const a of arrests) {
    const areas = detectAreas(a.charges);
    for (const area of areas) {
      if (!byArea[area]) byArea[area] = [];
      byArea[area].push(a);
    }
  }

  const lines = Object.entries(byArea)
    .map(([area, list]) => `  • ${list.length} ${area} arrest${list.length > 1 ? 's' : ''}`)
    .join('\n');

  const noAtty = arrests.filter(a => !a.has_attorney).length;
  const withBail = arrests.filter(a => a.bail_amount > 0).length;

  return {
    subject: `🚨 ${arrests.length} new arrest${arrests.length > 1 ? 's' : ''} in ${arrests[0]?.county} County — ${noAtty} with no attorney`,
    body: `New arrests matching your practice area in ${arrests[0]?.county} County:\n\n${lines}\n\n` +
          `${noAtty} have NO attorney of record\n` +
          `${withBail} have bail set\n\n` +
          `View all in Justice Gavel: https://justicegavel.app/arrests\n\n` +
          `— Justice Gavel Alert System\n` +
          `Unsubscribe: https://justicegavel.app/settings/alerts`,
    count: arrests.length,
    no_attorney_count: noAtty,
  };
}

function buildBailAgentAlert(agent, arrests) {
  const withBail = arrests.filter(a => a.bail_amount > 0);
  const amounts = withBail.map(a => a.bail_amount).filter(Boolean);
  const minBail = amounts.length ? Math.min(...amounts) : 0;
  const maxBail = amounts.length ? Math.max(...amounts) : 0;
  const totalBail = amounts.reduce((s, n) => s + n, 0);

  return {
    subject: `💰 ${withBail.length} new bookings in ${arrests[0]?.county} — bail $${minBail.toLocaleString()}–$${maxBail.toLocaleString()}`,
    body: `New bookings with bail set in ${arrests[0]?.county} County:\n\n` +
          `  • ${withBail.length} bookings with bail set\n` +
          `  • Bail range: $${minBail.toLocaleString()} – $${maxBail.toLocaleString()}\n` +
          `  • Total bail value: $${totalBail.toLocaleString()}\n\n` +
          `View all bookings: https://justicegavel.app/arrests\n\n` +
          `— Justice Gavel Alert System`,
    count: withBail.length,
    total_bail: totalBail,
  };
}

// ── User arrest monitors (Pro tier, routes/arrests.js /monitors) ──────────────
/**
 * monitorMatches — does an arrest record match a user's monitor?
 * Name: every word of the watched name must appear in the record's name
 * (case-insensitive), so "John Smith" matches "SMITH, JOHN A" but not
 * "John Doe". County/state filters apply when the monitor sets them
 * ('All' county = any).
 */
export function monitorMatches(monitor, arrest) {
  const watch = String(monitor.watch_name || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!watch.length) return false;
  const name = String(arrest.name || '').toLowerCase();
  if (!watch.every(w => name.includes(w))) return false;
  const mCounty = String(monitor.county || '').trim().toLowerCase();
  if (mCounty && mCounty !== 'all' &&
      mCounty !== String(arrest.county || '').trim().toLowerCase()) return false;
  const mState = String(monitor.state || '').trim().toUpperCase();
  if (mState && arrest.state && mState !== String(arrest.state).toUpperCase()) return false;
  return true;
}

/**
 * checkArrestMonitors — match every active user monitor against the new
 * arrest records of this run, push-notify owners of matches, and record
 * last_checked / last_result so the app can show them honestly.
 */
async function checkArrestMonitors(db, newArrests, { dryRun = false } = {}) {
  const monitors = await db.all(
    `SELECT id, user_id, COALESCE(watch_name, name) AS watch_name, county, state
       FROM arrest_monitors WHERE COALESCE(active, 1) = 1`
  ).catch(e => { logger.warn('[alerts] monitor query failed:', e?.message); return []; });

  let matched = 0;
  for (const m of monitors) {
    const hits = newArrests.filter(a => monitorMatches(m, a));
    if (hits.length) {
      matched++;
      if (!dryRun) {
        try {
          const { sendPushToUser } = await import('./pushDelivery.js');
          await sendPushToUser(m.user_id, {
            title: '🔔 Arrest monitor match',
            body: `A new public arrest record matches "${m.watch_name}"${hits[0].county ? ` in ${hits[0].county} County` : ''}. Open Arrest Monitor to review.`,
            data: { screen: 'ArrestMonitor' },
            channelId: 'case_updates',
          });
        } catch (e) {
          logger.warn('[alerts] monitor push failed (non-fatal):', e?.message);
        }
      }
    }
    if (!dryRun) {
      await db.run(
        `UPDATE arrest_monitors SET last_checked = NOW(), last_result = ? WHERE id = ?`,
        [hits.length ? 'found' : 'none', m.id]
      ).catch(e => logger.warn('[alerts] monitor update failed:', e?.message));
    }
  }
  if (monitors.length) {
    logger.info(`[alerts] ${monitors.length} monitors checked, ${matched} matched`);
  }
  return { monitors_checked: monitors.length, monitor_matches: matched };
}

function detectAreas(charges) {
  if (!charges) return ['General'];
  const found = [];
  for (const [area, keywords] of Object.entries(PRACTICE_AREA_KEYWORDS)) {
    const lower = charges.toLowerCase();
    if (keywords.some(kw => lower.includes(kw))) found.push(area);
  }
  return found.length ? found : ['General'];
}

// ── Send alert (email via Resend / push notification) ────────────────────────
async function sendAlert(recipient, message, type, db) {
  logger.info(`  📧 ${type} alert → ${recipient.name} (${recipient.email || 'no email'})`);

  // Record in DB regardless of delivery
  await db.run(
    `INSERT INTO attorney_alerts
      (recipient_id, recipient_type, subject, body, count, sent_at)
     VALUES (?,?,?,?,?,NOW())`,
    [recipient.id, type, message.subject, message.body, message.count]
  ).catch(e => logger.warn('[alerts] DB insert error:', e?.message));

  // ── Email via services/email.js (Resend; logged only without RESEND_API_KEY)
  if (recipient.email) {
    try {
      const { sendEmail } = await import('./email.js');
      await sendEmail({ to: recipient.email, subject: message.subject, text: message.body });
    } catch (emailErr) {
      logger.warn('[alerts] Email send failed (non-fatal):', emailErr?.message);
    }
  }

  return true;
}

// ── Main alert runner ─────────────────────────────────────────────────────────
export async function sendArrestAlerts(options = {}) {
  const db = await getDb();   // shared Postgres pool (close() is a no-op)

  // attorney_alerts table managed by db/index.js

  // Get unsent arrest records
  const newArrests = await db.all(
    `SELECT id, name, booking_date, charges, bail_amount, county, state, jail_location, has_attorney, alert_sent
     FROM arrest_records
     WHERE alert_sent = 0
       AND ${realArrestSql()}   -- never alert on sample/seed or taken-down rows
       AND created_at >= (NOW() - INTERVAL '24 hours')
     ORDER BY booking_date DESC
     LIMIT 1000`
  );

  if (!newArrests.length) {
    logger.info('[alerts] No new arrests to alert on');
    // Still stamp user monitors so the app shows an honest "Last checked".
    const monitorStats = await checkArrestMonitors(db, [], options);
    return { alerts_sent: 0, ...monitorStats };
  }

  logger.info(`[alerts] ${newArrests.length} new arrests to process`);

  // Group by county
  const byCounty = {};
  for (const a of newArrests) {
    if (!byCounty[a.county]) byCounty[a.county] = [];
    byCounty[a.county].push(a);
  }

  let alertsSent = 0;

  // ── Alert attorneys ──
  const attorneys = await db.all(
    `SELECT id, name, email, city, state, specialties FROM lawyers WHERE active = 1 AND email IS NOT NULL`
  );

  for (const attorney of attorneys) {
    const specialties = (() => {
      try { return JSON.parse(attorney.specialties || '[]'); } catch { return []; }
    })();

    // Find arrests in attorney's county matching their specialties
    for (const [, arrests] of Object.entries(byCounty)) {
      // Geography match — attorney's city should be in this county's cities
      // Geographic match: attorney is notified if their city is in the same state as the arrests,
      // OR if county name matches. Expanded from TN-only to nationwide.
      const arrestState    = (arrests[0]?.state || '').toUpperCase();

      // Skip if attorney is in a completely different state
      // (allow through if neither has state data — legacy records)
      if (attorney.state && arrests[0]?.state &&
          attorney.state.toUpperCase() !== arrestState) continue;

      // Filter arrests matching attorney specialties
      const relevantArrests = arrests.filter(a =>
        specialties.length === 0 ||
        specialties.some(s => matchesPracticeArea(a.charges, s))
      );

      if (relevantArrests.length === 0) continue;

      const msg = buildAttorneyAlert(attorney, relevantArrests);
      const sent = await sendAlert(attorney, msg, 'attorney', db);
      if (sent) alertsSent++;
    }
  }

  // ── Alert bail agents ──
  const bailAgents = await db.all(
    `SELECT id, name, email, city, state FROM bail_agents WHERE active = 1 AND email IS NOT NULL`
  );

  const arrestsWithBail = newArrests.filter(a => a.bail_amount > 0);

  for (const agent of bailAgents) {
    if (!arrestsWithBail.length) continue;
    const msg = buildBailAgentAlert(agent, arrestsWithBail);
    const sent = await sendAlert(agent, msg, 'bail_agent', db);
    if (sent) alertsSent++;
  }

  // ── User arrest monitors (push alerts + last_checked bookkeeping) ──
  const monitorStats = await checkArrestMonitors(db, newArrests, options);

  // Mark all processed arrests as alerted
  const ids = newArrests.map(a => a.id);
  if (ids.length && !options.dryRun) {
    await db.run(
      `UPDATE arrest_records SET alert_sent = 1 WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
  }

  logger.info(`[alerts] ✅ ${alertsSent} alerts sent, ${newArrests.length} arrests marked`);
  return { alerts_sent: alertsSent, arrests_processed: newArrests.length, ...monitorStats };
}
