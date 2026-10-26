/**
 * server.js — process entry point.
 *
 * Order matters:
 *   1. instrument.js  — Sentry (single init; no-op without SENTRY_DSN)
 *   2. config.js      — env normalisation + production validation
 *   3. app.js         — Express app (no side effects beyond building routes)
 * Then: connect DB (fatal if DATABASE_URL set but unreachable), listen on
 * $PORT (default 4000), start background jobs, and install the ONE set of
 * process handlers (signals, uncaught errors) with a single shutdown path.
 */
import './instrument.js';
import { validateEnv, APP_ENV } from './config.js';
import logger from './utils/logger.js';
import { APP_VERSION, GIT_COMMIT_SHORT, HOST_PLATFORM, INSTANCE_ID } from './utils/version.js';

validateEnv();   // exits(1) in production when JWT/ENCRYPTION/DATABASE_URL are missing

const { default: app } = await import('./app.js');
const { initDb, closeDb } = await import('./db/index.js');
const { startAllWatchdogs, stopAllWatchdogs } = await import('./monitoring/selfHealing.js');
const { startScheduler, stopScheduler } = await import('./services/scheduler.js');
const { startAIWorkers, stopAIWorkers } = await import('./services/aiQueue.js');
const { startContentRefreshSchedule } = await import('./services/contentRefresh.js');
const { runOnce, quarterKey, dayKey } = await import('./utils/jobLock.js');

// ── 1. Database — fail startup when DATABASE_URL is set but unreachable ───────
try {
  const db = await initDb();
  logger.info({ engine: db.engine }, '[server] database ready');
} catch (e) {
  logger.fatal?.({ err: e.message }, '[server] database connection failed — refusing to start');
  logger.error('[server] FATAL: database connection failed:', e.message);
  process.exit(1);
}

// ── Quarterly bar license re-verification ─────────────────────────────────────
async function runBarReVerification() {
  try {
    const { getDb } = await import('./db/index.js');
    const { sendEmail } = await import('./services/email.js');
    const db = await getDb();

    // Find attorneys whose bar verification is >90 days old
    const staleVerified = await db.all(`
      SELECT u.id, u.email, u.bar_number, u.bar_state,
             u.bar_verified_at,
             CAST(EXTRACT(EPOCH FROM (NOW() - u.bar_verified_at))/86400 AS INTEGER) as days_since_verify
        FROM users u
       WHERE u.bar_verified = 1
         AND u.role IN ('attorney', 'defender')
         AND (u.bar_verified_at < (NOW() - INTERVAL '90 days') OR u.bar_verified_at IS NULL)
       ORDER BY u.bar_verified_at ASC
       LIMIT 50
    `).catch(() => []);

    if (!staleVerified.length) {
      logger.info('[Bar Re-Verify] All bar verifications current (within 90 days)');
      return;
    }

    // Flag them for re-verification
    const ids = staleVerified.map(a => a.id);
    await db.run(
      `UPDATE users SET bar_reverify_needed = 1 WHERE id IN (${ids.map(()=>'?').join(',')})`,
      ids
    ).catch(() => {});

    // Email admin with the list and direct state bar lookup links
    const STATE_BAR_LOOKUP = {
      AL:'https://www.alabar.org/for-the-public/find-a-lawyer/',
      AK:'https://www.alaskabar.org/for-the-public/find-an-attorney/',
      AZ:'https://www.azbar.org/for-the-public/attorney-search/',
      AR:'https://www.arkbar.com/for-the-public/find-a-lawyer',
      CA:'https://apps.calbar.ca.gov/attorney/Licensee/Detail/',
      CO:'https://www.cobar.org/For-the-Public/Find-A-Lawyer',
      CT:'https://www.ctbar.org/public/find-a-lawyer',
      DE:'https://www.dsba.org/for-the-public/find-an-attorney/',
      DC:'https://www.dcbar.org/for-the-public/find-a-member/',
      FL:'https://www.floridabar.org/directories/find-mbr/',
      GA:'https://www.gabar.org/for-the-public/find-a-lawyer.cfm',
      HI:'https://www.hawaiilawyerreferral.com/',
      ID:'https://isb.idaho.gov/member-search/',
      IL:'https://www.illinoislawyerfinder.com/',
      IN:'https://www.inbar.org/findlawyer/',
      IA:'https://www.iowabar.org/find-an-attorney/',
      KS:'https://www.ksbar.org/find-a-lawyer',
      KY:'https://www.kybar.org/find-a-lawyer/',
      LA:'https://www.lsba.org/public/find-a-lawyer.aspx',
      ME:'https://www.mainebar.org/page/findalawyer',
      MD:'https://www.msba.org/for-the-public/find-a-lawyer/',
      MA:'https://www.massbbo.org/licensed-attorneys/',
      MI:'https://www.michbar.org/member/attorney_search',
      MN:'https://lprb.mncourts.gov/attorney-directory/',
      MS:'https://www.msbar.org/for-the-public/find-a-lawyer/',
      MO:'https://www.mobar.org/find-a-lawyer/',
      MT:'https://montanabar.org/findlawyer/',
      NE:'https://www.nebar.com/find-a-lawyer/',
      NV:'https://www.nvbar.org/find-a-lawyer/',
      NH:'https://www.nhbar.org/find-a-lawyer/',
      NJ:'https://www.njlawpublichub.com/attorney-search/',
      NM:'https://www.nmbar.org/for-the-public/find-an-attorney/',
      NY:'https://iapps.courts.state.ny.us/attorneyservices/search',
      NC:'https://www.ncbar.gov/member-services/attorney-search/',
      ND:'https://www.sband.org/find-a-lawyer/',
      OH:'https://www.supremecourt.ohio.gov/attorney-services/attorney-status/',
      OK:'https://www.okbar.org/find-a-lawyer/',
      OR:'https://www.osbar.org/public/ris/memberDirectory.html',
      PA:'https://www.padisciplinaryboard.org/for-the-public/find-attorney/',
      RI:'https://www.ribar.com/public-resources/find-a-lawyer/',
      SC:'https://www.scbar.org/find-a-lawyer/',
      SD:'https://statebarofsouthdakota.com/find-a-lawyer/',
      TN:'https://www.tba.org/member-services/find-an-attorney/',
      TX:'https://www.texasbar.com/AM/Template.cfm?Section=Find_A_Lawyer',
      UT:'https://www.utahbar.org/public-information/attorney-search/',
      VT:'https://www.vtbar.org/public/find-a-lawyer/',
      VA:'https://www.vsb.org/site/publications/member_search',
      WA:'https://www.mywsba.org/PersonifyEbusiness/WSBAOnline/SearchLawyersAndParalegals.aspx',
      WV:'https://wvbar.org/for-the-public/find-a-lawyer/',
      WI:'https://www.wisbar.org/forPublic/Pages/find-a-lawyer.aspx',
      WY:'https://www.wyomingbar.org/for-the-public/hire-a-lawyer/',
    };

    const lines = staleVerified.map(a => {
      const url = STATE_BAR_LOOKUP[a.bar_state] || 'https://www.americanbar.org/tools/find-a-lawyer/';
      return `• ${a.email} — Bar: ${a.bar_number} (${a.bar_state}) — Last verified: ${a.days_since_verify}d ago\n  ${url}`;
    });

    await sendEmail({
      to:      process.env.ADMIN_EMAIL || 'admin@justicegavel.app',
      subject: `[JTB Quarterly] ${staleVerified.length} attorney bar licenses need re-verification`,
      text: [
        `${staleVerified.length} JTB-verified attorney(s) have not had their bar status confirmed in 90+ days.`,
        `Please verify each is still ACTIVE and IN GOOD STANDING at their state bar website.`,
        ``,
        `If a license is suspended or revoked: immediately set bar_verified=0 in the admin panel.`,
        ``,
        ...lines,
        ``,
        `Admin panel: ${process.env.ADMIN_PANEL_URL || 'https://admin.justicegavel.app'}/attorneys`,
      ].join('\n'),
    }).catch(err => logger.error({ err: err.message }, '[Bar Re-Verify] Email failed'));

    logger.warn(`[Bar Re-Verify] Quarterly check: ${staleVerified.length} attorneys flagged for re-verification — admin notified`);
  } catch (err) {
    logger.error({ err: err.message }, '[Bar Re-Verify] Failed');
  }
}


// ── 2. HTTP server ────────────────────────────────────────────────────────────
// $PORT is injected by the host (Render: 10000 by default). Bind every
// interface — a container that listens on 127.0.0.1 is unreachable.
const PORT = parseInt(process.env.PORT || '4000', 10);
const server = app.listen(PORT, '0.0.0.0');
server.keepAliveTimeout = 65000;  // > Caddy/nginx idle timeout (60s)
server.headersTimeout   = 66000;

const timers = [];

server.on('listening', () => {
  const addr = server.address() || {};
  logger.info({
    msg: '[server] Justice Gavel API started',
    port: addr.port || PORT,
    env: APP_ENV,
    version: APP_VERSION,
    commit: GIT_COMMIT_SHORT,
    platform: HOST_PLATFORM,
    instance: INSTANCE_ID,
  });
  logger.info(`[server] Mode: ${process.env.DEMO_MODE === 'true' ? 'DEMO' : 'LIVE'}`);
  if (process.send) process.send('ready');   // PM2 wait_ready

  // ── 3. Background jobs (after we are accepting traffic) ──────────────────
  try { startAIWorkers(); } catch (e) { logger.error({ err: e.message }, '[server] AI workers failed to start'); }
  if (process.env.REDIS_URL) {
    import('./services/questionExplainer.js').then(m => m.startExplainerWorker()).catch(e => logger.error({ err: e.message }, '[server] explainer worker failed'));
    import('./services/barPrepNotifications.js').then(m => m.startNotificationWorker()).catch(e => logger.error({ err: e.message }, '[server] bar-prep notification worker failed'));
  }
  try { startScheduler(); } catch (e) { logger.error({ err: e.message }, '[server] scheduler failed to start'); }
  try { startAllWatchdogs(); } catch (e) { logger.error({ err: e.message }, '[server] watchdogs failed to start'); }
  try {
    const t = startContentRefreshSchedule();
    if (t) { t.unref?.(); timers.push(t); }
  } catch (e) { logger.error({ err: e.message }, '[server] content refresh failed to start'); }

  // Reminder delivery (scheduled_pushes) runs in startScheduler → reminderDispatcher.

  // Quarterly bar re-verification: once per calendar quarter across every
  // instance and restart (job_runs claim), checked daily from 2 minutes after
  // boot. (A bare 90-day setInterval does not fit Node's 32-bit timer and once
  // ran in a tight loop — see the step-9 ops pass.)
  const DAY_MS = 24 * 60 * 60 * 1000;
  const barTick = () => runOnce('bar-reverify', quarterKey(), runBarReVerification)
    .catch(err => logger.error({ err: err.message }, '[Bar Re-Verify] run failed'));
  const first = setTimeout(() => {
    barTick();
    const t = setInterval(barTick, DAY_MS);
    t.unref();
    timers.push(t);
  }, 2 * 60 * 1000);
  first.unref();
  timers.push(first);

  // Bond Desk: texts sent for bail agents (5¢ each) go on their plan invoice once a day.
  const textBillTick = () => import('./services/bondDesk/textBilling.js')
    .then(async (m) => runOnce('bd-text-billing', dayKey(), async () => m.billAgentTexts(await (await import('./db/index.js')).getDb())))
    .catch(err => logger.error({ err: err.message }, '[bond-desk] text billing run failed'));
  const firstBill = setTimeout(() => {
    textBillTick();
    const t = setInterval(textBillTick, DAY_MS);
    t.unref();
    timers.push(t);
  }, 5 * 60 * 1000);
  firstBill.unref();
  timers.push(firstBill);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`[server] FATAL: port ${PORT} is already in use`);
  } else {
    logger.error('[server] FATAL server error:', err.message);
  }
  process.exit(1);
});

// ── 4. Single shutdown path ───────────────────────────────────────────────────
let shuttingDown = false;
async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`[server] ${signal} received — starting graceful shutdown`);

  // Hard stop at 25 s. Keep it below render.yaml maxShutdownDelaySeconds (30)
  // so the host's SIGKILL never cuts the drain short (render_blueprint.test.js).
  const force = setTimeout(() => {
    logger.error('[server] Graceful shutdown timed out — forcing exit');
    process.exit(exitCode || 1);
  }, 25_000);
  force.unref();

  try {
    await new Promise(resolve => { server.close(() => resolve()); });
    server.closeAllConnections?.();
  } catch { /* ignore */ }
  timers.forEach(t => { clearInterval(t); clearTimeout(t); });
  try { stopScheduler(); } catch { /* ignore */ }
  try { stopAllWatchdogs(); } catch { /* ignore */ }
  try { await stopAIWorkers(); } catch { /* ignore */ }
  try { await closeDb(); } catch { /* ignore */ }
  try {
    if (process.env.SENTRY_DSN) {
      const Sentry = await import('@sentry/node');
      await Sentry.close(2000);
    }
  } catch { /* ignore */ }
  logger.info('[server] Shutdown complete');
  process.exit(exitCode);
}

process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('SIGINT',  () => shutdown('SIGINT', 0));

// A thrown exception leaves the process in an unknown state: report it and
// exit non-zero so the platform (Render/PM2/Docker) restarts us.
process.on('uncaughtException', (err) => {
  logger.error('[server] Uncaught exception:', err?.stack || err);
  try {
    import('./monitoring/errorNotifier.js')
      .then(({ notifyCritical }) => notifyCritical?.('Uncaught exception — process restarting', {
        code: 'uncaught_exception', error: err?.message, stack: err?.stack?.slice(0, 500),
      }))
      .catch(() => {});
  } catch { /* ignore */ }
  shutdown('uncaughtException', 1);
});

// Unhandled rejections are logged (a stray background promise should not take
// down every user), but they are never silently swallowed.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason?.message ?? String(reason), stack: reason?.stack?.split('\n').slice(0, 5).join(' | ') },
    '[server] Unhandled promise rejection');
});
