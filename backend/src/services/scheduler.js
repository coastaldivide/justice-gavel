/**
 * scheduler.js — Justice Gavel Full Automated Pipeline
 * ─────────────────────────────────────────────────────
 *
 *  NIGHTLY (3 AM Central):
 *    1. Google/Yelp provider refresh
 *    2. Arrest record harvest (97 cities)
 *    3. Attorney/bail agent platform alerts (app subscribers)
 *    4. Outbound bot — SMS to bondsmen, email to attorneys (revenue engine)
 *    5. Expire old payment links (nightly run)
 *    6. State bar national provider refresh (Sundays only)
 *    7. Golden Gavel eligibility sweep (all active subscribers)
 *    8. Docket deadline reminders + overdue webhook dispatch
 *
 *  EVERY 2 HOURS:
 *    9. Expire payment links (catch any missed by nightly run)
 *
 * Requires LIVE_REFRESH=true to activate cron jobs.
 * Manual trigger: POST /api/bot/run  or  POST /api/admin/refresh
 */

import cron from 'node-cron';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from '../config.js';
import { sendArrestAlerts }                    from './arrest_alerts.js';
import { runOutboundBot, expireOldPaymentLinks } from './outbound_bot.js';
import { processGoldenGavelAward }              from '../routes/golden_gavel.js';
import logger                                   from '../utils/logger.js';
import { startHealthScanScheduler, stopHealthScanScheduler, runHealthScan } from './healthScan.js';
import { archiveCompletedDocketEntries, checkAccountInactivity } from './retention.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Lazy Expo singleton for docket push notifications ─────────────────────────
let _schedExpo = null;
async function getSchedExpo() {
  if (_schedExpo) return _schedExpo;
  const { Expo } = await import('expo-server-sdk');
  _schedExpo = new Expo();
  return _schedExpo;
}

const SCRIPTS = {
  refresh:         path.resolve(__dirname, '../scripts/refresh.js'),
  scrapeArrests:   path.resolve(__dirname, '../scripts/scrape_arrests.js'),
  scrapeProviders: path.resolve(__dirname, '../scripts/scrape_providers_national.js'),
};

let nightlyTask = null;
let linkExpiryTask = null;

// ── Spawn a Node script with streamed output ──────────────────────────────────
function runScript(scriptPath, args = []) {
  return new Promise((resolve) => {
    const child = spawn('node', [scriptPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    let out = '';
    child.stdout?.on('data', d => { out += d; });
    child.stderr?.on('data', d => { out += d; });
    child.on('close', code => {
      const tag = `[scheduler:${path.basename(scriptPath, '.js')}]`;
      logger.info(`${tag} exit ${code}`);
      if (out.trim()) out.trim().split('\n').slice(-5).forEach(l => logger.info(`${tag} ${l}`));
      resolve({ code, output: out });
    });
    child.on('error', err => {
      logger.error(`[scheduler] spawn error: ${err.message}`);
      resolve({ code: 1, output: err.message });
    });
  });
}

// Exported for admin route manual trigger
export function runRefresh(options = {}) {
  const args = [];
  if (options.city)   args.push('--city',   options.city);
  if (options.type)   args.push('--type',   options.type);
  if (options.source) args.push('--source', options.source);
  return runScript(SCRIPTS.refresh, args);
}

// ── Step 8: Docket deadline reminders + overdue dispatch ─────────────────────
// Runs on the nightly pipeline. Checks for:
//   1. Entries due in N days (reminder_days field) — sends push notifications
//   2. Entries past due with status='pending' — fires docket.deadline_overdue webhook
async function runDocketReminderSweep() {
  try {
    const { getDb }              = await import('../db/index.js');
    const { dispatchWebhookEvent } = await import('../routes/webhooks/outbound.js');

    const db    = await getDb();
    const today = new Date().toISOString().slice(0, 10);

    // ── 1. Upcoming reminders ─────────────────────────────────────────────────
    // Find entries where due_date - reminder_days = today and reminded_at is NULL
    const upcoming = await db.all(
      `SELECT de.*, f.name as firm_name, u.push_token, u.display_name as attorney_name
       FROM docket_entries de
       LEFT JOIN firms f ON f.id = de.firm_id
       LEFT JOIN users u ON u.id = de.assigned_to
       WHERE de.status = 'pending'
         AND de.reminded_at IS NULL
         AND date(de.due_date, '-' || de.reminder_days || ' days') <= ?
         AND de.due_date >= ?
       LIMIT 500`,
      [today, today]
    ).catch(() => []);

    let remindSent = 0;
    for (const entry of upcoming) {
      try {
        // Push notification if attorney has a token
        if (entry.push_token) {
          const { Expo } = await import('expo-server-sdk');
          const expo     = await getSchedExpo();
          if (Expo.isExpoPushToken(entry.push_token)) {
            const daysUntil = Math.ceil(
              (new Date(entry.due_date + 'T12:00:00Z') - new Date()) / 86400000
            );
            await expo.sendPushNotificationsAsync([{
              to:    entry.push_token,
              sound: 'default',
              title: `⚖️ Deadline ${daysUntil === 0 ? 'TODAY' : `in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`}`,
              body:  `${entry.title}${entry.due_time ? ` at ${entry.due_time}` : ''}`,
              data:  { type: 'deadline_reminder', entry_id: entry.id },
            }]);
          }
        }
        // Mark as reminded
        await db.run(
          "UPDATE docket_entries SET reminded_at=? WHERE id=?",
          [new Date().toISOString(), entry.id]
        );
        remindSent++;
      } catch (e) {
        logger.warn(`[scheduler/docket] reminder error for entry ${entry.id}:`, e.message);
      }
    }

    // ── 2. Overdue entries — fire docket.deadline_overdue webhook ─────────────
    const overdue = await db.all(
      `SELECT id, firm_id, title, due_date, priority
       FROM docket_entries
       WHERE status = 'pending' AND due_date < ?
       LIMIT 200`,
      [today]
    ).catch(() => []);

    for (const entry of overdue) {
      if (!entry.firm_id) continue;
      dispatchWebhookEvent(db, entry.firm_id, 'docket.deadline_overdue', {
        entry_id:  entry.id,
        title:     entry.title,
        due_date:  entry.due_date,
        priority:  entry.priority,
        days_past: Math.ceil((new Date() - new Date(entry.due_date + 'T12:00:00Z')) / 86400000),
      }).catch(() => {});
    }

    logger.info(`[scheduler/docket] ${remindSent} reminders sent, ${overdue.length} overdue events dispatched`);
    return { remindSent, overdueDispatched: overdue.length };
  } catch (e) {
    logger.error('[scheduler/docket] sweep error:', e.message);
    return { remindSent: 0, overdueDispatched: 0 };
  }
}

// ── Full nightly pipeline ─────────────────────────────────────────────────────
async function runNightlyJob() {
  const nowDate = new Date();
  const now     = nowDate.toISOString();
  logger.info(`\n[scheduler] ════════════════════════════════════`);
  logger.info(`[scheduler] Nightly pipeline — ${now}`);
  logger.info(`[scheduler] ════════════════════════════════════`);

  // Step 1: Google/Yelp provider refresh — criminal + civil attorneys
  // Declare isSunday here — used by Step 1b AND Step 6 (bar scrape).
  // Must be outside the hasGoogle/hasYelp block so Step 6 can always read it.
  const isSunday  = nowDate.getDay() === 0;
  const hasGoogle = !!process.env.GOOGLE_PLACES_KEY;
  const hasYelp   = !!process.env.YELP_API_KEY;
  if (hasGoogle || hasYelp) {
    logger.info('[scheduler] Step 1a/8 — Criminal attorney refresh');
    await runScript(SCRIPTS.refresh, ['--type', 'lawyers'])
      .catch(e => logger.error('[scheduler] criminal refresh error:', e.message));

    // Civil attorney refresh — runs weekly (Sundays) to avoid rate limits
    if (isSunday) {
      logger.info('[scheduler] Step 1b/8 — Civil attorney refresh (weekly, Sunday)');
      await runScript(SCRIPTS.refresh, ['--type', 'civil'])
        .catch(e => logger.error('[scheduler] civil refresh error:', e.message));
    } else {
      logger.info('[scheduler] Step 1b/8 — Civil refresh skipped (runs Sundays)');
    }
  } else {
    logger.info('[scheduler] Step 1/8 — skipped (no API keys)');
  }

  // Step 2: Arrest harvest
  logger.info('[scheduler] Step 2/8 — Arrest harvest (97 cities)');
  await runScript(SCRIPTS.scrapeArrests, ['--since', '24h'])
    .catch(e => logger.error('[scheduler] scrape error:', e.message));

  // Step 3: Platform alerts (app subscribers)
  logger.info('[scheduler] Step 3/8 — Platform subscriber alerts');
  try {
    const r = await sendArrestAlerts();
    logger.info(`[scheduler] Alerts: ${r.alerts_sent} sent, ${r.arrests_processed} arrests`);
  } catch (e) {
    logger.error('[scheduler] Alert error:', e.message);
  }

  // Step 4: Outbound bot — idempotency_key per message, safe to re-run (see outbound_bot.js)
  logger.info('[scheduler] Step 4/8 — Outbound revenue bot');
  try {
    const r = await runOutboundBot({ runType: 'nightly' });
    if (r.skipped) {
      logger.info(`[scheduler] Bot skipped: ${r.reason}`);
    } else {
      logger.info(`[scheduler] Bot: ${r.messagesSent} messages sent, ${r.errors?.length || 0} errors`);
    }
  } catch (e) {
    logger.error('[scheduler] Bot error:', e.message);
  }

  // Step 5: Expire payment links
  logger.info('[scheduler] Step 5/8 — Expire old payment links');
  try {
    const r = await expireOldPaymentLinks();
    if (r.expired > 0) logger.info(`[scheduler] Expired ${r.expired} payment links`);
  } catch (e) {
    logger.error('[scheduler] Expiry error:', e.message);
  }

  // Step 6: Sunday — state bar provider refresh (reuses isSunday from Step 1b above)
  if (isSunday) {
    logger.info('[scheduler] Step 6/8 — Sunday bar directory refresh');
    await runScript(SCRIPTS.scrapeProviders, ['--source', 'bar'])
      .catch(e => logger.error('[scheduler] bar scrape error:', e.message));
  } else {
    logger.info('[scheduler] Step 6/8 — skipped (runs Sundays only)');
  }

  // Step 7: Golden Gavel eligibility sweep (all active subscribers)
  logger.info('[scheduler] Step 7/8 — Golden Gavel eligibility sweep');
  try {
    const { getDb: getMainDb } = await import('../db/index.js');
    const db = await getMainDb();
    if (db) {
      const subs = await db.all(
        "SELECT DISTINCT user_id FROM subscriptions WHERE status IN ('active','trialing')"
      );
      let awarded = 0;
      let revoked = 0;
      for (const { user_id } of subs) {
        const r = await processGoldenGavelAward(user_id).catch(() => null);
        if (r?.action === 'awarded') awarded++;
        if (r?.action === 'revoked') revoked++;
      }
      logger.info(`[scheduler] Golden Gavel: ${awarded} awarded, ${revoked} revoked`);
    }
  } catch (e) {
    logger.error('[scheduler] Golden Gavel sweep error:', e.message);
  }

  // Step 8: Docket deadline reminders + overdue webhooks
  logger.info('[scheduler] Step 8/8 — Docket reminder sweep');
  try {
    const r8 = await runDocketReminderSweep();
    logger.info(`[scheduler] Docket: ${r8.remindSent} reminders, ${r8.overdueDispatched} overdue events`);
  } catch (e) {
    logger.error('[scheduler] Docket sweep error:', e.message);
  }

  // Step 9: Docket archiving — completed entries older than 90 days → archive table
  // Keeps active docket fast for long-running cases without losing any history.
  logger.info('[scheduler] Step 9 — Docket archive sweep');
  try {
    const r9 = await archiveCompletedDocketEntries(90);
    if (r9.archived > 0) logger.info(`[scheduler] Docket: archived ${r9.archived} completed entries`);
  } catch (e) {
    logger.error('[scheduler] Docket archive error:', e.message);
  }

  // Step 10: Account inactivity check (weekly — Sunday only to avoid daily noise)
  if (isSunday) {
    logger.info('[scheduler] Step 10 — Account inactivity check (Sunday)');
    try {
      const r10 = await checkAccountInactivity();
      logger.info(`[scheduler] Inactivity: ${r10.alerted} alert(s) sent`);
    } catch (e) {
      logger.error('[scheduler] Inactivity check error:', e.message);
    }
  }

  logger.info(`[scheduler] ════════ Pipeline complete ════════\n`);
}

// ── Start all scheduled jobs ──────────────────────────────────────────────────
export function startScheduler() {
  if (!CONFIG.LIVE_REFRESH) {
    logger.info('[scheduler] LIVE_REFRESH=false — all scheduled jobs disabled.');
    logger.info('[scheduler] Set LIVE_REFRESH=true in .env to activate.');
    return;
  }

  const cronExpr = process.env.REFRESH_CRON || '0 3 * * *';
  const tz       = process.env.REFRESH_TZ   || 'America/Chicago';

  if (!cron.validate(cronExpr)) {
    logger.error(`[scheduler] Invalid REFRESH_CRON: "${cronExpr}" — jobs disabled.`);
    return;
  }

  // Main nightly pipeline
  nightlyTask = cron.schedule(cronExpr, runNightlyJob, { timezone: tz });
  logger.info(`[scheduler] Nightly pipeline: ${cronExpr} (${tz})`);

  // Payment link expiry — every 2 hours
  linkExpiryTask = cron.schedule('0 */2 * * *', async () => {
    try {
      const r = await expireOldPaymentLinks();
      if (r.expired > 0) logger.info(`[scheduler] Expired ${r.expired} payment links`);
    } catch (e) {
      logger.error('[scheduler] Link expiry error:', e.message);
    }
  }, { timezone: tz });
  logger.info('[scheduler] Link expiry: every 2 hours');

  // Health scan — every 12 hours (6 AM and 6 PM Central)
  // Monitors: precedent currency, asylum bar risk, signal invariants,
  // bias audit, database health, tracker deadlines, escalation SLA
  startHealthScanScheduler();

  logger.info('[scheduler] All jobs active. Bot will generate revenue automatically.');
}

export function stopScheduler() {
  if (nightlyTask)    { nightlyTask.destroy();    nightlyTask    = null; }
  if (linkExpiryTask) { linkExpiryTask.destroy(); linkExpiryTask = null; }
  stopHealthScanScheduler();
}

export { runNightlyJob };
