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

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/providers.sqlite');

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

function detectAreas(charges) {
  if (!charges) return ['General'];
  const found = [];
  for (const [area, keywords] of Object.entries(PRACTICE_AREA_KEYWORDS)) {
    const lower = charges.toLowerCase();
    if (keywords.some(kw => lower.includes(kw))) found.push(area);
  }
  return found.length ? found : ['General'];
}

// ── Send alert (email via SendGrid / push notification) ───────────────────────
async function sendAlert(recipient, message, type, db) {
  // In production: integrate with SendGrid or Twilio
  // For now: log and record in DB
  logger.info(`  📧 ${type} alert → ${recipient.name} (${recipient.email || 'no email'})`);
  logger.info(`     Subject: ${message.subject}`);

  // Record in DB that alert was sent
  await db.run(
    `INSERT INTO attorney_alerts
      (recipient_id, recipient_type, subject, body, count, sent_at)
     VALUES (?,?,?,?,?,datetime('now'))`,
    [recipient.id, type, message.subject, message.body, message.count]
  );

  return true;
}

// ── Main alert runner ─────────────────────────────────────────────────────────
export async function sendArrestAlerts(options = {}) {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.run('PRAGMA journal_mode=WAL');

  // attorney_alerts table managed by db/index.js

  // Get unsent arrest records
  const newArrests = await db.all(
    `SELECT id, name, booking_date, charges, bail_amount, county, state, jail_location, has_attorney, alert_sent
     FROM arrest_records
     WHERE alert_sent = 0
       AND created_at >= datetime('now', '-24 hours')
     ORDER BY booking_date DESC
     LIMIT 1000`
  );

  if (!newArrests.length) {
    logger.info('[alerts] No new arrests to alert on');
    await db.close();
    return { alerts_sent: 0 };
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
    `SELECT id, name, email, city, specialties FROM lawyers WHERE active = 1 AND email IS NOT NULL`
  );

  for (const attorney of attorneys) {
    const specialties = (() => {
      try { return JSON.parse(attorney.specialties || '[]'); } catch { return []; }
    })();

    const attorneyCity = (attorney.city || '').split(',')[0].trim();

    // Find arrests in attorney's county matching their specialties
    for (const [county, arrests] of Object.entries(byCounty)) {
      // Geography match — attorney's city should be in this county's cities
      const countyConfig = Object.values({
        davidson: { cities: ['Nashville'] },
        shelby: { cities: ['Memphis'] },
        knox: { cities: ['Knoxville'] },
        hamilton: { cities: ['Chattanooga'] },
      }).find(c => c.cities.some(city =>
        attorneyCity.toLowerCase().includes(city.toLowerCase())
      ));

      if (!countyConfig && county !== 'Davidson' && county !== 'Shelby') continue;

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
    `SELECT id, name, email, city FROM bail_agents WHERE active = 1 AND email IS NOT NULL`
  );

  const arrestsWithBail = newArrests.filter(a => a.bail_amount > 0);

  for (const agent of bailAgents) {
    if (!arrestsWithBail.length) continue;
    const msg = buildBailAgentAlert(agent, arrestsWithBail);
    const sent = await sendAlert(agent, msg, 'bail_agent', db);
    if (sent) alertsSent++;
  }

  // Mark all processed arrests as alerted
  const ids = newArrests.map(a => a.id);
  if (ids.length && !options.dryRun) {
    await db.run(
      `UPDATE arrest_records SET alert_sent = 1 WHERE id IN (${ids.join(',')})`,
    );
  }

  logger.info(`[alerts] ✅ ${alertsSent} alerts sent, ${newArrests.length} arrests marked`);
  await db.close();
  return { alerts_sent: alertsSent, arrests_processed: newArrests.length };
}
