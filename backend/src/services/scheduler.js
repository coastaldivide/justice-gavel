import { logIgnored } from '../utils/ignored.js';
import { scheduleGuarded } from '../utils/cronGuard.js';
import { getDb } from '../db/index.js';
import { runScheduled, purgeJobRuns } from '../utils/jobLock.js';

/**
 * scheduler.js — Justice Gavel Full Automated Pipeline
 * ─────────────────────────────────────────────────────
 *
 *  NIGHTLY (3 AM Central):
 *    1. Google/Yelp provider refresh → main Postgres via services/dataRefresh
 *       (new providers inserted; changes to existing rows staged in
 *       provider_update_proposals for admin review — never written directly;
 *       nothing deleted). Skipped with a log line when no key is set.
 *    2. Arrest ingestion from operator-configured feeds (ARREST_FEED_URLS)
 *    3. Attorney/bail agent platform alerts (app subscribers)
 *    4. Outbound bot — SMS to bondsmen, email to attorneys (revenue engine)
 *    5. Expire old payment links (nightly run)
 *    6. State-bar listing refresh + recovery-agent refresh (Sundays only)
 *    7. Golden Gavel eligibility sweep (all active subscribers)
 *    8. Docket deadline reminders + overdue webhook dispatch
 *
 *  EVERY 2 HOURS:
 *    9. Expire payment links (catch any missed by nightly run)
 *
 * Requires LIVE_REFRESH=true to activate cron jobs.
 * Manual trigger: POST /api/bot/run  or  POST /api/admin/refresh
 * Every data-refresh step records a scrape_runs row (status + counts).
 *
 * LIVE_REFRESH semantics: it gates ONLY the data-refresh / outbound pipeline
 * above (scrapers, arrest harvest, outbound bot, nightly sweeps, health scan).
 * User-facing delivery is not a data refresh and runs in every API process
 * regardless of LIVE_REFRESH (REMINDERS_ENABLED=false switches it off per
 * process): reminder delivery (services/reminderDispatcher.js), the 24-hour
 * consultation reminder (hourly), Expo receipt checks (every 30 minutes), Bond Desk court
 * texts (every 5 minutes, 'bd-court-reminders'), Bond Desk automatic payment-plan charges (hourly,
 * 'bd-autopay', only while BOND_AUTOPAY_ENABLED is on), and
 * the daily clean-up of expired sign-in tokens, idempotency keys and job
 * records.
 *
 * More than one instance: every cron job claims its fire in job_runs
 * (utils/jobLock.js — node-cron's scheduled time is the key), so it runs on
 * one instance; rows that are sent (bookings, docket entries) are also
 * claimed one by one before anything goes out.
 */

import cron from 'node-cron';
import { CONFIG } from '../config.js';
import { runRefresh, runScheduledDataRefresh } from './dataRefresh/scheduled.js';
import { sendArrestAlerts }                    from './arrest_alerts.js';
import { runOutboundBot, expireOldPaymentLinks } from './outbound_bot.js';
import { processGoldenGavelAward }              from '../routes/golden_gavel.js';
import logger                                   from '../utils/logger.js';
import { startHealthScanScheduler, stopHealthScanScheduler } from './healthScan.js';
import { archiveCompletedDocketEntries, checkAccountInactivity } from './retention.js';
import { startReminderDispatcher, stopReminderDispatcher, remindersEnabled } from './reminderDispatcher.js';
import { sendPushToUser, checkPushReceipts } from './pushDelivery.js';
import { msg, userLang, formatTime } from '../i18n/index.js';
import { slotLabel } from './consultationSlots.js';

let nightlyTask = null;
let linkExpiryTask = null;
let consultReminderTask = null;
let receiptsTask = null;
let tokenCleanupTask = null;
let bdCourtTask = null;
let checkinTextsTask = null;
let checkinMissedTask = null;
let bdAutopayTask = null;

// Data-refresh steps live in services/dataRefresh/scheduled.js (Postgres only);
// runRefresh is re-exported for the admin console and existing callers.
export { runRefresh, runScheduledDataRefresh };

// ── Step 8: Docket deadline reminders + overdue dispatch ─────────────────────
// Runs on the nightly pipeline. Checks for:
//   1. Entries due in N days (reminder_days field) — sends push notifications
//   2. Entries past due with status='pending' — fires docket.deadline_overdue webhook
export async function runDocketReminderSweep() {
  try {
    const { dispatchWebhookEvent } = await import('../routes/webhooks/outbound.js');
    const db    = await getDb();
    const today = new Date().toISOString().slice(0, 10);

    // ── 1. Upcoming reminders: due_date - reminder_days <= today, not reminded yet
    const upcoming = await db.all(
      `SELECT de.id, de.title, de.due_date, de.due_time, de.assigned_to
         FROM docket_entries de
        WHERE de.status = 'pending'
          AND de.reminded_at IS NULL
          AND (de.due_date::date - (COALESCE(de.reminder_days, 0) || ' days')::interval)::date <= ?::date
          AND de.due_date::date >= ?::date
        LIMIT 500`,
      [today, today]
    );

    let remindSent = 0;
    for (const entry of upcoming) {
      try {
        // Claimed first: a second instance (or a re-run) never reminds twice.
        const claimed = await db.get('UPDATE docket_entries SET reminded_at = NOW() WHERE id = ? AND reminded_at IS NULL RETURNING id', [entry.id]);
        if (!claimed || !entry.assigned_to) continue;
        const lang = await userLang(db, entry.assigned_to);
        const due = String(entry.due_date).slice(0, 10);
        const days = Math.round((Date.parse(`${due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
        const title = days <= 0 ? msg(lang, 'push.docket.title_today')
          : days === 1 ? msg(lang, 'push.docket.title_tomorrow') : msg(lang, 'push.docket.title_days', { days });
        const time = formatTime(entry.due_time, lang);
        const r = await sendPushToUser(entry.assigned_to, {
          title,
          body: time ? msg(lang, 'push.docket.body_time', { title: entry.title, time }) : String(entry.title || ''),
          data: { type: 'deadline_reminder', entry_id: Number(entry.id) },
        });
        if (r.sent) remindSent++;
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
    );

    for (const entry of overdue) {
      if (!entry.firm_id) continue;
      dispatchWebhookEvent(db, entry.firm_id, 'docket.deadline_overdue', {
        entry_id:  entry.id,
        title:     entry.title,
        due_date:  entry.due_date,
        priority:  entry.priority,
        days_past: Math.ceil((new Date() - new Date(String(entry.due_date).slice(0, 10) + 'T12:00:00Z')) / 86400000),
      }).catch(logIgnored('services/scheduler'));
    }

    logger.info(`[scheduler/docket] ${remindSent} reminders sent, ${overdue.length} overdue events dispatched`);
    return { remindSent, overdueDispatched: overdue.length };
  } catch (e) {
    logger.error('[scheduler/docket] sweep error:', e.message);
    return { remindSent: 0, overdueDispatched: 0 };
  }
}

// ── Full nightly pipeline ─────────────────────────────────────────────────────

// ── Post-case expungement trigger ─────────────────────────────────────────────
// Nightly. A case closed with a favourable outcome 25–35 days ago, whose owner
// has not opened the expungement screen since: one push, ONCE per case (the
// dedupe key is checked against every reminder ever planned). It is planned as
// an 'expungement' reminder, so the dispatcher sends it in the person's
// language and respects the "Expungement" notification switch.
export async function runExpungementTriggerSweep(db, now = new Date()) {
  try {
    const eligible = await db.all(
      `SELECT c.user_id, c.id AS case_id, c.title
         FROM cases c
        WHERE c.status IN ('Closed', 'Dismissed')
          AND c.deleted_at IS NULL
          AND LOWER(COALESCE(c.outcome, c.close_outcome, '')) IN ('dismissed','acquitted','not_guilty','deferred','plea_deal')
          AND COALESCE(c.outcome_recorded_at, c.closed_at) >= (?::timestamptz - INTERVAL '35 days')
          AND COALESCE(c.outcome_recorded_at, c.closed_at) <= (?::timestamptz - INTERVAL '25 days')
          AND NOT EXISTS (SELECT 1 FROM expungement_check_log l
                           WHERE l.user_id = c.user_id AND l.checked_at >= (?::timestamptz - INTERVAL '60 days'))
          AND NOT EXISTS (SELECT 1 FROM scheduled_pushes p WHERE p.dedupe_key = 'expunge:' || c.id)
        ORDER BY c.id
        LIMIT 200`,
      [now.toISOString(), now.toISOString(), now.toISOString()]
    );
    let planned = 0;
    for (const row of eligible) {
      const lang = await userLang(db, row.user_id);
      const title = String(row.title || '').trim();
      const r = await db.run(
        `INSERT INTO scheduled_pushes (user_id, push_token, title, body, data, deliver_at, notification_type, case_id, status, priority, dedupe_key)
         VALUES (?, NULL, ?, ?, ?, ?, 'expungement', ?, 'pending', 'normal', ?)
         ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'sending') DO NOTHING`,
        [row.user_id, msg(lang, 'push.expunge.title'),
          title ? msg(lang, 'push.expunge.body', { case: title.slice(0, 80) }) : msg(lang, 'push.expunge.body_untitled'),
          JSON.stringify({ type: 'expungement', screen: 'Expungement', caseId: Number(row.case_id), lang }),
          now.toISOString(), row.case_id, `expunge:${row.case_id}`]);
      if (r.changes) planned++;
    }
    logger.info(`[scheduler/expunge] planned ${planned} expungement reminders (${eligible.length} eligible cases)`);
    return { planned, eligible: eligible.length };
  } catch (e) {
    logger.warn('[scheduler/expunge] sweep failed:', e?.message);
    return { planned: 0, eligible: 0, error: e?.message };
  }
}


// ── 24-hour consultation reminder ─────────────────────────────────────────────
// Hourly. Confirmed consultations starting in 20–28 hours: a push to the client
// and to the attorney's account, and an e-mail to the client — each in that
// person's language, with the time in the zone the booking was made in. Every
// booking is claimed (reminder_sent) before anything is sent, so it is reminded
// once, whatever the number of instances.
export async function runConsultationReminderSweep(db, now = new Date()) {
  const upcoming = await db.all(
    `SELECT cb.id, cb.user_id, cb.lawyer_id, cb.lawyer_name, cb.starts_at, cb.time_zone, cb.duration_min,
            u.display_name AS client_name, u.email AS client_email
       FROM consultation_bookings cb
       JOIN users u ON u.id = cb.user_id
      WHERE cb.status = 'confirmed'
        AND cb.reminder_sent IS NULL
        AND cb.starts_at BETWEEN (?::timestamptz + INTERVAL '20 hours') AND (?::timestamptz + INTERVAL '28 hours')
      ORDER BY cb.starts_at ASC
      LIMIT 100`,
    [now.toISOString(), now.toISOString()]
  );
  if (!upcoming.length) return { sent: 0 };
  const { sendConsultationReminder } = await import('./email.js');
  let sent = 0;
  for (const row of upcoming) {
    try {
      const claimed = await db.get('UPDATE consultation_bookings SET reminder_sent = NOW() WHERE id = ? AND reminder_sent IS NULL RETURNING id', [row.id]);
      if (!claimed) continue;
      const clientLang = await userLang(db, row.user_id);
      const whenClient = slotLabel(row.starts_at, row.time_zone, clientLang);
      await sendPushToUser(row.user_id, {
        title: msg(clientLang, 'push.consult_reminder.title'),
        body:  msg(clientLang, 'push.consult_reminder.body', { lawyer: row.lawyer_name, when: whenClient }),
        data:  { type: 'consultation_reminder', screen: 'Booking', bookingId: Number(row.id) },
        channelId: 'case_updates',
      });
      if (row.lawyer_id) {
        const atty = await db.get(
          `SELECT u.id FROM users u JOIN attorney_profiles ap ON ap.user_id = u.id WHERE ap.lawyer_id = ? LIMIT 1`,
          [row.lawyer_id]);
        if (atty) {
          const attyLang = await userLang(db, atty.id);
          await sendPushToUser(atty.id, {
            title: msg(attyLang, 'push.consult_reminder.atty_title'),
            body:  msg(attyLang, 'push.consult_reminder.atty_body', {
              client: row.client_name || msg(attyLang, 'consult.a_client'), when: slotLabel(row.starts_at, row.time_zone, attyLang) }),
            data:  { type: 'consultation_reminder', screen: 'AttorneyInbox', bookingId: Number(row.id) },
            channelId: 'attorney_bookings',
          });
        }
      }
      if (row.client_email) {
        await sendConsultationReminder({
          to: row.client_email, lang: clientLang, clientName: row.client_name || null,
          attorneyName: row.lawyer_name, when: whenClient, durationMin: row.duration_min,
        }).catch(e => logger.warn('[scheduler/reminder] e-mail failed', row.id, e?.message));
      }
      sent++;
    } catch (e) {
      logger.warn('[scheduler/reminder] row failed', row.id, e?.message);
    }
  }
  if (sent) logger.info(`[scheduler/reminder] Sent ${sent} consultation reminders`);
  return { sent };
}

function runNightlyJob(ctx) {
  return runScheduled('nightly', ctx, nightlyPipeline);
}

async function nightlyPipeline() {
  const nowDate = new Date();
  const now     = nowDate.toISOString();
  logger.info(`\n[scheduler] ════════════════════════════════════`);
  logger.info(`[scheduler] Nightly pipeline — ${now}`);
  logger.info(`[scheduler] ════════════════════════════════════`);

  // Steps 1, 2 and (Sundays) 6: data refresh into the main Postgres database
  const isSunday = nowDate.getDay() === 0;
  try {
    await runScheduledDataRefresh({ isSunday });
  } catch (e) {
    logger.error('[scheduler] data refresh error:', e.message);
  }

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
  const r8 = await runDocketReminderSweep();
  logger.info(`[scheduler] Docket: ${r8.remindSent} reminders, ${r8.overdueDispatched} overdue events`);
  // Post-case expungement trigger
  await runExpungementTriggerSweep(await getDb());

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
  // User-facing delivery first — independent of LIVE_REFRESH (see header).
  try { startReminderDispatcher(); } catch (e) { logger.error('[scheduler] reminder dispatcher failed to start:', e.message); }
  const tz = process.env.REFRESH_TZ || 'America/Chicago';
  if (remindersEnabled()) {
    consultReminderTask = scheduleGuarded('7 * * * *', 'consultation-reminders',
      (ctx) => runScheduled('consultation-reminders', ctx, async () => runConsultationReminderSweep(await getDb())));
    receiptsTask = scheduleGuarded('*/30 * * * *', 'push-receipts',
      (ctx) => runScheduled('push-receipts', ctx, () => checkPushReceipts()));
    // Bond Desk court texts: reminders, "Did you make it?", the morning-after text and agent
    // alerts (services/bondDesk/courtDates.js). One instance per fire; rows are claimed SKIP LOCKED.
    bdCourtTask = scheduleGuarded('*/5 * * * *', 'bd-court-reminders',
      (ctx) => runScheduled('bd-court-reminders', ctx, async () => {
        const { runBondCourtReminders } = await import('./bondDesk/courtDates.js');
        return runBondCourtReminders(await getDb());
      }));
    // Check-ins by text link: reminder texts + the gentle missed-check-in text (quiet hours 09–21
    // in the defendant's zone) and the hourly missed-check-in alert to the agent
    // (services/checkinTexts.js; one instance per fire via job_runs).
    checkinTextsTask = scheduleGuarded('*/15 * * * *', 'checkin-texts',
      (ctx) => runScheduled('checkin-texts', ctx, async () => (await import('./checkinTexts.js')).runCheckinTexts(await getDb())));
    checkinMissedTask = scheduleGuarded('4 * * * *', 'checkin-missed',
      (ctx) => runScheduled('checkin-missed', ctx, async () => (await import('./checkinTexts.js')).runMissedCheckins(await getDb())));
  }
  // Bond Desk automatic payment-plan charges (⚖ BOND_AUTOPAY_ENABLED; services/bondDesk/autopay.js):
  // hourly so every agency is charged on its own local due day from 08:00; each installment and
  // attempt is claimed once (unique row + Stripe idempotency key), so extra runs charge nothing twice.
  bdAutopayTask = scheduleGuarded('17 * * * *', 'bd-autopay',
    (ctx) => runScheduled('bd-autopay', ctx, async () => {
      const { runAutopay } = await import('./bondDesk/autopay.js');
      return runAutopay(await getDb());
    }));
  // Daily maintenance: expired sign-in tokens, idempotency keys, job records.
  tokenCleanupTask = scheduleGuarded('15 3 * * *', 'refresh-token-cleanup',
    (ctx) => runScheduled('refresh-token-cleanup', ctx, cleanupExpiredTokens), { timezone: tz });

  if (!CONFIG.LIVE_REFRESH) {
    logger.info('[scheduler] LIVE_REFRESH=false — data-refresh / outbound jobs disabled (reminders, receipts and clean-up still run).');
    logger.info('[scheduler] Set LIVE_REFRESH=true in .env to activate.');
    return;
  }

  const cronExpr = process.env.REFRESH_CRON || '0 3 * * *';

  if (!cron.validate(cronExpr)) {
    logger.error(`[scheduler] Invalid REFRESH_CRON: "${cronExpr}" — jobs disabled.`);
    return;
  }

  // Main nightly pipeline (runNightlyJob claims its fire: one instance runs it)
  nightlyTask = cron.schedule(cronExpr, runNightlyJob, { timezone: tz });
  logger.info(`[scheduler] Nightly pipeline: ${cronExpr} (${tz})`);

  // Payment link expiry — every 2 hours
  linkExpiryTask = scheduleGuarded('0 */2 * * *', 'payment-link-expiry', (ctx) => runScheduled('payment-link-expiry', ctx, async () => {
    const r = await expireOldPaymentLinks();
    if (r.expired > 0) logger.info(`[scheduler] Expired ${r.expired} payment links`);
  }), { timezone: tz });
  logger.info('[scheduler] Link expiry: every 2 hours');

  // Health scan — every 12 hours (6 AM and 6 PM Central)
  // Monitors: precedent currency, asylum bar risk, signal invariants,
  // bias audit, database health, tracker deadlines, escalation SLA
  startHealthScanScheduler();

  logger.info('[scheduler] All jobs active.');
}

export function stopScheduler() {
  stopReminderDispatcher();
  for (const t of [consultReminderTask, receiptsTask, tokenCleanupTask, nightlyTask, linkExpiryTask, bdCourtTask, checkinTextsTask, checkinMissedTask, bdAutopayTask]) t?.destroy?.();
  consultReminderTask = receiptsTask = tokenCleanupTask = nightlyTask = linkExpiryTask = bdCourtTask = checkinTextsTask = checkinMissedTask = bdAutopayTask = null;
  stopHealthScanScheduler();
}

export { runNightlyJob };

// ── Daily clean-up (3:15 AM, one instance) ────────────────────────────────────
// Expired / used refresh tokens, expired idempotency keys, finished AI job
// states and job-run records older than 30 days.
export async function cleanupExpiredTokens() {
  try {
    const db = await getDb();
    const result = await db.run(
      `DELETE FROM refresh_tokens WHERE expires_at < NOW() OR used = 1`
    );
    logger.info('[scheduler] token cleanup:', result?.changes, 'rows removed');
    const { purgeExpiredIdempotencyKeys } = await import('../middleware/idempotency.js');
    await purgeExpiredIdempotencyKeys(db).catch(e => logger.warn('[scheduler] idempotency-key purge failed:', e?.message));
    const { purgeFinishedJobs } = await import('./aiQueue.js');
    await purgeFinishedJobs(db).catch(e => logger.warn('[scheduler] AI job purge failed:', e?.message));
    await purgeJobRuns(db).catch(e => logger.warn('[scheduler] job-run purge failed:', e?.message));
  } catch (err) {
    logger.error('[scheduler] token cleanup failed:', err?.message);
  }
}
