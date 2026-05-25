import 'dotenv/config';
import logger from './utils/logger.js';
import app from './app.js';

// ── Push delivery loop — drain scheduled_pushes every 60s ──────────────────
import { deliverScheduledPushes, checkPushReceipts } from './services/pushDelivery.js';
import { startContentRefreshSchedule } from './services/contentRefresh.js';

// ── Legal content refresh schedule (daily at low-traffic window) ───────────
const contentRefreshInterval = startContentRefreshSchedule();

// ── Quarterly bar license re-verification ─────────────────────────────────────
// Checks whether bar_verified attorneys still show as active in our records.
// Full real-time API verification is state-dependent (CA, NY, FL, TX have APIs).
// This job flags attorneys whose verification is >90 days old for admin review,
// and emails admin with a list of attorneys to spot-check against state bar sites.
//
// WHY QUARTERLY:
//   Bar suspensions and disbarments are published within days of action.
//   A 90-day re-check window catches most disciplinary actions before they
//   cause user harm, while keeping admin workload manageable.
//
async function runBarReVerification() {
  try {
    const { getDb } = await import('./db/index.js');
    const { sendEmail } = await import('./services/sendgrid.js');
    const db = await getDb();

    // Find attorneys whose bar verification is >90 days old
    const staleVerified = await db.all(`
      SELECT u.id, u.email, u.bar_number, u.bar_state,
             u.bar_verified_at,
             CAST(julianday('now') - julianday(u.bar_verified_at) AS INTEGER) as days_since_verify
        FROM users u
       WHERE u.bar_verified = 1
         AND u.role IN ('attorney', 'defender')
         AND (u.bar_verified_at < datetime('now', '-90 days') OR u.bar_verified_at IS NULL)
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
    }).catch(err => logger.error('[Bar Re-Verify] Email failed:', err.message));

    logger.warn('[Bar Re-Verify] Quarterly check:', staleVerified.length,
      'attorneys flagged for re-verification — admin notified');
  } catch (err) {
    logger.error('[Bar Re-Verify] Failed:', err.message);
  }
}

// Run quarterly (90 days) — first run 2 minutes after startup to avoid startup noise
const BAR_REVERIFY_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;
setTimeout(() => {
  runBarReVerification();
  setInterval(runBarReVerification, BAR_REVERIFY_INTERVAL_MS);
}, 2 * 60 * 1000);

const pushInterval = setInterval(async () => {
  try { await deliverScheduledPushes(); }
  catch (err) { logger.error('[Push] Delivery loop error:', err.message); }
}, 60_000);
// Drain once at startup for any overdue pushes
deliverScheduledPushes().catch(err => logger.error('[Push] Startup drain error:', err.message));

const PORT = parseInt(process.env.PORT || '4000', 10);

const server = app.listen(PORT, '0.0.0.0', () => {
  const addr = server?.address?.() || {};
  logger.info({
    msg: '[server] Justice Gavel API started',
    port: addr.port || process.env.PORT || 4000,
    env: process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || 'local',
    version: process.env.npm_package_version || '2.9.2',
    db: process.env.POSTGRES_URL ? 'postgres' : 'sqlite',
  });
  logger.info(`[server] Mode: ${process.env.DEMO_MODE !== 'false' ? 'DEMO' : 'LIVE'}`);
  // Signal PM2 that the process is ready (required for wait_ready: true)
  if (process.send) process.send('ready');
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.warn(`[server] Port ${PORT} in use — process already running, continuing`);
    // Don't exit — let the existing server handle requests
  } else {
    logger.error('[server] Server error:', err.message);
    process.exit(1);
  }
});

// Keep-alive + timeout settings — prevents hanging connections
server.keepAliveTimeout = 65000;  // > Caddy/nginx idle timeout (60s)
server.headersTimeout   = 66000;

// ── Graceful shutdown ──────────────────────────────────────────────────────────
// ECS / Railway / Fly.io send SIGTERM before killing the container.
// We get ~30s to finish in-flight requests, flush queues, and close DB cleanly.
function shutdown(signal) {
  logger.info(`[server] ${signal} received — starting graceful shutdown`);

  // 1. Stop accepting new connections
  server.close(async () => {
    logger.info('[server] HTTP server closed — draining in-flight work');

    // 2. Stop background intervals
    clearInterval(pushInterval);
    clearInterval(contentRefreshInterval);

    // 3. Final push drain before exit
    try {
      const { deliverScheduledPushes } = await import('./services/pushDelivery.js');
      await deliverScheduledPushes();
    } catch {}

    // 4. Close DB connection
    try {
      const { getDb } = await import('./db/index.js');
      const db = await getDb();
      if (db._close) await db._close();
    } catch {}

    logger.info('[server] Shutdown complete');
    process.exit(0);
  });

  // Force-exit if shutdown takes more than 25 seconds
  setTimeout(() => {
    logger.error('[server] Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 25_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Catch uncaught exceptions — log and exit cleanly
process.on('uncaughtException', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.warn('[server] Port already in use — existing instance running');
    return; // Don't shutdown
  }
  logger.error('[server] Uncaught exception:', err.message, err.stack);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.error('[server] Unhandled rejection:', reason);
  // Don't exit for rejections — log and continue
});
