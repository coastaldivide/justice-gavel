/**
 * dataRefresh/scheduled.js — the LIVE_REFRESH data steps of the nightly
 * pipeline (services/scheduler.js) and the admin "refresh now" entry point,
 * all writing the main Postgres database:
 *   step 1  provider refresh (Google / Yelp) for the metro areas — civil
 *           attorneys added on Sundays
 *   step 2  arrest ingestion from ARREST_FEED_URLS (validated feeds only)
 *   step 6  Sundays: public state-bar listings + recovery agents
 * Each step records a scrape_runs row; a step whose key is missing is skipped
 * with a log line and a 'skipped' run row.
 */
import { logIgnored } from '../../utils/ignored.js';
import { getDb } from '../../db/index.js';
import logger from '../../utils/logger.js';
import { runProviderRefresh, METRO_CITIES } from './providerRefresh.js';
import { runRecoveryAgentRefresh } from './recoveryRefresh.js';
import { ALL_BAR_CITIES } from './barCities.js';
import { placesKeyConfigured } from './googlePlaces.js';
import { recordSkippedRun, startRun, finishRun, newCounts } from './runLog.js';
import { runIngestion } from '../arrest_ingest.js';

/**
 * Manual / admin provider refresh — same in-process Postgres path as the
 * nightly step (POST /api/admin/refresh). Resolves to the run result
 * ({ runId, status, counts, message }).
 */
export async function runRefresh(options = {}) {
  const db = await getDb();
  const types = !options.type || options.type === 'all' ? ['lawyers', 'bail'] : [options.type];
  const sources = !options.source || options.source === 'all' ? ['google', 'yelp'] : [options.source];
  let cities = METRO_CITIES;
  if (options.city) {
    const m = /^(.+?),\s*([A-Za-z]{2})$/.exec(String(options.city).trim());
    if (!m) throw new Error('city must look like "Nashville, TN"');
    cities = [{ city: m[1].trim(), state: m[2].toUpperCase() }];
  }
  return await runProviderRefresh({
    db, cities, types, sources, dryRun: !!options.dryRun, trigger: options.trigger || 'admin',
  });
}

/**
 * The LIVE_REFRESH data steps of the nightly pipeline, all against the main
 * Postgres database. Exported for the admin console and tests.
 */
export async function runScheduledDataRefresh({ isSunday = new Date().getDay() === 0 } = {}) {
  const db = await getDb();
  const out = {};
  if (db.engine !== 'postgres') {
    logger.warn('[scheduler] data refresh skipped — DATABASE_URL (Postgres) is not configured');
    return { skipped: 'no_postgres' };
  }

  // Step 1: provider refresh (criminal attorneys + bail agents; civil on Sundays)
  const hasGoogle = placesKeyConfigured();
  const hasYelp   = !!process.env.YELP_API_KEY;
  if (hasGoogle || hasYelp) {
    logger.info('[scheduler] Step 1/8 — Provider refresh (Google/Yelp → Postgres)');
    out.providers = await runProviderRefresh({
      db, cities: METRO_CITIES, types: isSunday ? ['lawyers', 'bail', 'civil'] : ['lawyers', 'bail'],
      sources: ['google', 'yelp'], trigger: 'scheduler', job: 'providers',
    }).catch((e) => { logger.error('[scheduler] provider refresh error:', e.message); return { status: 'failed', message: e.message }; });
    logger.info(`[scheduler] Providers: ${out.providers.status} — ${JSON.stringify(out.providers.counts || {})}`);
  } else {
    logger.info('[scheduler] Step 1/8 — provider refresh skipped: GOOGLE_PLACES_KEY / YELP_API_KEY not set');
    out.providers = { status: 'skipped', runId: await recordSkippedRun(db, {
      job: 'providers', trigger: 'scheduler', message: 'GOOGLE_PLACES_KEY and YELP_API_KEY are not set — provider refresh skipped',
    }).catch(() => null) };
  }

  // Step 2: arrests from configured, validated feeds (never heuristic page scraping)
  logger.info('[scheduler] Step 2/8 — Arrest feed ingestion (ARREST_FEED_URLS)');
  out.arrests = await runArrestIngestStep(db);

  // Step 6 (Sundays): public state-bar listings + recovery agents
  if (isSunday) {
    logger.info('[scheduler] Step 6/8 — Sunday state-bar listing refresh');
    out.stateBar = await runProviderRefresh({
      db, cities: ALL_BAR_CITIES, types: ['lawyers'], sources: ['bar'], trigger: 'scheduler', job: 'state_bar_listings',
    }).catch((e) => { logger.error('[scheduler] bar refresh error:', e.message); return { status: 'failed' }; });
    if (hasGoogle) {
      logger.info('[scheduler] Step 6b/8 — Sunday recovery-agent refresh');
      out.recovery = await runRecoveryAgentRefresh({ db, trigger: 'scheduler' })
        .catch((e) => { logger.error('[scheduler] recovery refresh error:', e.message); return { status: 'failed' }; });
    } else {
      logger.info('[scheduler] Step 6b/8 — recovery-agent refresh skipped: GOOGLE_PLACES_KEY not set');
      out.recovery = { status: 'skipped', runId: await recordSkippedRun(db, {
        job: 'recovery_agents', trigger: 'scheduler', message: 'GOOGLE_PLACES_KEY is not set — recovery-agent refresh skipped',
      }).catch(() => null) };
    }
  } else {
    logger.info('[scheduler] Step 6/8 — skipped (runs Sundays only)');
  }
  return out;
}

async function runArrestIngestStep(db) {
  let runId = null;
  try {
    runId = await startRun(db, { job: 'arrest_feeds', trigger: 'scheduler', params: {} });
    const r = await runIngestion({ dryRun: false });
    const counts = { ...newCounts(), inserted: r.inserted, skipped: r.skipped, errors: r.errors };
    const status = !r.feeds_configured
      ? 'skipped'
      : undefined;
    await finishRun(db, runId, counts, {
      status,
      message: r.feeds_configured ? `${r.sources.length} feed(s)` : 'ARREST_FEED_URLS not configured — nothing ingested',
      errorSamples: [...(r.config_errors || []), ...r.sources.filter(x => x.error).map(x => `${x.id}: ${x.error}`)],
    });
    logger.info(`[scheduler] Arrest feeds: ${r.inserted} inserted, ${r.skipped} skipped, ${r.errors} errors`);
    return { runId, ...r };
  } catch (e) {
    logger.error('[scheduler] arrest ingestion error:', e.message);
    if (runId) await finishRun(db, runId, { errors: 1 }, { status: 'failed', errorSamples: [e.message] }).catch(logIgnored('services/dataRefresh/scheduled'));
    return { runId, status: 'failed' };
  }
}

