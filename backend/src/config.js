/**
 * config.js — Centralised environment configuration
 *
 * REQUIRED_IN_PROD:  app refuses to start in live mode if any of these are absent.
 * OPTIONAL_WARNINGS: logged at startup when absent; features degrade gracefully.
 * INTEGRATION_VARS:  Year 3 OAuth2 provider credentials — each enables one provider.
 *
 * All process.env reads in the application should go through CONFIG or direct
 * process.env with a clear fallback. Magic strings like 'dev_secret_change_me'
 * should only appear here, not scattered across route files.
 */

import 'dotenv/config';
import crypto from 'crypto';
import logger from './utils/logger.js';

const IS_PROD = process.env.NODE_ENV === 'production';

// ── Stripe key aliases — accept either STRIPE_SECRET_KEY or STRIPE_SECRET ─────
if (!process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET) process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET;
if (!process.env.STRIPE_SECRET && process.env.STRIPE_SECRET_KEY) process.env.STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
// Railway/Supabase sometimes expose POSTGRES_URL instead of DATABASE_URL
if (!process.env.DATABASE_URL && process.env.POSTGRES_URL) process.env.DATABASE_URL = process.env.POSTGRES_URL;

// ── Hard requirements in production ───────────────────────────────────────────
export const REQUIRED_IN_PROD = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY', 'DATABASE_URL'];

// ── Dev-only generated secrets (never in production) ──────────────────────────
// In development/test a missing secret is replaced by a random per-process value
// so nothing ever signs tokens with a well-known string. Tokens/encrypted data do
// not survive a restart in that case — set the vars in backend/.env to persist.
if (!IS_PROD) {
  for (const [k, bytes] of [['JWT_SECRET', 48], ['JWT_REFRESH_SECRET', 48], ['ENCRYPTION_KEY', 32]]) {
    if (!process.env[k]) {
      process.env[k] = crypto.randomBytes(bytes).toString('hex');
      if (process.env.NODE_ENV !== 'test') logger.warn(`[config] ${k} not set — generated a random dev-only value`);
    }
  }
}

// DEMO_MODE: always off in production unless explicitly DEMO_MODE=true;
// on by default elsewhere unless DEMO_MODE=false.
const DEMO_MODE = IS_PROD ? process.env.DEMO_MODE === 'true' : process.env.DEMO_MODE !== 'false';
process.env.DEMO_MODE = DEMO_MODE ? 'true' : 'false';

/** Standard 503 body when Stripe is not configured. */
export const PAYMENTS_UNAVAILABLE = Object.freeze({
  error:   'payments_unavailable',
  message: 'Payments are not available yet',
});

/** True when a Stripe secret key is configured. */
export const stripeConfigured = () => !!(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET);

// ── Optional features — each disables one feature when absent ────────────────
const OPTIONAL_FEATURES = {
  ANTHROPIC_API_KEY:     'AI chat, motions, research and analysis disabled (AI endpoints return 503 ai_unavailable)',
  STRIPE_SECRET_KEY:     'Payments disabled (billing endpoints return 503 payments_unavailable; everyone is on the free tier)',
  STRIPE_WEBHOOK_SECRET: 'Stripe webhooks cannot be verified (webhook returns 400)',
  RESEND_API_KEY:        'Email disabled — emails are logged instead of sent',
  REDIS_URL:             'BullMQ queue disabled — AI jobs run in-process',
  SENTRY_DSN:            'Error tracking disabled',
  GOOGLE_PLACES_KEY:     'Google Places fallback disabled',
  SUPABASE_URL:          'Supabase storage/auth helpers disabled',
  OPENAI_API_KEY:        'Whisper transcription disabled',
  // JSON array of public arrest-feed objects ({id,url,state,county}); see
  // services/arrest_ingest.js and RAILWAY_ENV_SETUP.md for the exact shape.
  ARREST_FEED_URLS:      'Arrest ingestion disabled — POST /api/arrests/ingest has no feed to pull and arrest coverage is empty',
  // Default (unset/false) is the safe production setting. "true" is for demos only:
  // seeded sample arrest rows (source seed_v1 etc.) then appear in read-only arrest
  // views flagged is_sample:true / labelled "Sample record" in the app. They are
  // never alerted on, messaged about or sold, whatever this is set to.
  SHOW_SAMPLE_ARRESTS:   'Sample (seeded) arrest records are hidden from users (set SHOW_SAMPLE_ARRESTS=true only for demos)',
};

// ── Deployment environment (APP_ENV) ─────────────────────────────────────────
// NODE_ENV says HOW the server runs (production hardening on/off); APP_ENV says
// WHICH deployment it is. Staging is a production-hardened build with its own
// database, keys and data: NODE_ENV=production + APP_ENV=staging. APP_ENV
// labels logs, Sentry events and /health, and staging refuses live payment keys.
export const APP_ENVS = ['development', 'test', 'staging', 'production'];

/** Errors (fatal) and warnings for an environment — pure, for tests. */
export function checkAppEnv(env = process.env) {
  const errors = [], warnings = [];
  const nodeEnv = env.NODE_ENV || 'development';
  const appEnv = String(env.APP_ENV || (nodeEnv === 'production' ? 'production' : nodeEnv)).trim().toLowerCase();
  if (!APP_ENVS.includes(appEnv)) errors.push(`APP_ENV="${env.APP_ENV}" is not one of ${APP_ENVS.join(', ')}`);
  if (nodeEnv === 'staging') errors.push('NODE_ENV=staging is not supported — run staging with NODE_ENV=production and APP_ENV=staging');
  if (appEnv === 'production' && nodeEnv !== 'production') errors.push('APP_ENV=production requires NODE_ENV=production');
  if (appEnv === 'staging') {
    if (nodeEnv !== 'production') warnings.push('APP_ENV=staging without NODE_ENV=production — staging will not match production behaviour');
    const live = ['STRIPE_SECRET_KEY', 'STRIPE_SECRET'].filter(k => /^(sk|rk)_live_/.test(String(env[k] || '')));
    if (live.length) errors.push(`${live[0]} is a LIVE Stripe key — staging must use test keys (sk_test_…)`);
    const prodUrl = env === process.env ? process.env.PRODUCTION_DATABASE_URL : env.PRODUCTION_DATABASE_URL;
    if (env.DATABASE_URL && prodUrl && env.DATABASE_URL === prodUrl) {
      errors.push('DATABASE_URL equals PRODUCTION_DATABASE_URL — staging must never use the production database');
    }
    if (env.LIVE_REFRESH === 'true') warnings.push('LIVE_REFRESH=true on staging — nightly jobs (provider refresh, reminders) will run against the staging DB');
  }
  return { appEnv, errors, warnings };
}

export const APP_ENV = checkAppEnv().appEnv;

/**
 * validateEnv — called once by server.js at startup.
 * Exits the process in production when a hard requirement is missing; otherwise
 * logs one "feature disabled" line per missing optional variable.
 */
export function validateEnv({ exit = true } = {}) {
  const missing = IS_PROD ? REQUIRED_IN_PROD.filter(k => !process.env[k]) : [];
  if (missing.length) {
    logger.error('[config] ❌ Missing required env vars for production:', missing.join(', '));
    if (exit) process.exit(1);
  }
  for (const [key, msg] of Object.entries(OPTIONAL_FEATURES)) {
    const present = key === 'STRIPE_SECRET_KEY' ? stripeConfigured()
      : key === 'SHOW_SAMPLE_ARRESTS' ? String(process.env[key] || '').trim().toLowerCase() === 'true'
      : !!process.env[key];
    if (!present) logger.warn(`[config] ${key} not set — ${msg}`);
  }
  const envCheck = checkAppEnv();
  for (const w of envCheck.warnings) logger.warn(`[config] ${w}`);
  if (envCheck.errors.length) {
    for (const e of envCheck.errors) logger.error(`[config] ❌ ${e}`);
    if (exit) process.exit(1);
  }
  if (IS_PROD && String(process.env.SHOW_SAMPLE_ARRESTS || '').trim().toLowerCase() === 'true') {
    logger.warn('[config] ⚠️  SHOW_SAMPLE_ARRESTS=true in production — generated sample arrest records are visible to users (labelled "Sample record"). Use for demos only.');
  }
  return { missing, envErrors: envCheck.errors };
}

// ── Exported configuration ─────────────────────────────────────────────────────
export const CONFIG = {
  DEMO_MODE,

  // ── Feature flags ────────────────────────────────────────────────────────────
  LIVE_PAYMENTS:  process.env.LIVE_PAYMENTS  === 'true',
    LIVE_EMAIL:     process.env.LIVE_EMAIL      === 'true',
  LIVE_REFRESH:   process.env.LIVE_REFRESH    === 'true',

  // ── Infrastructure ───────────────────────────────────────────────────────────
  POSTGRES_URL:   process.env.DATABASE_URL || process.env.POSTGRES_URL || '',
  USE_POSTGRES:   !!(process.env.DATABASE_URL || process.env.POSTGRES_URL),
  SENTRY_DSN:     process.env.SENTRY_DSN      || '',
  PORT:           parseInt(process.env.PORT   || '4000', 10),

  // ── AI ───────────────────────────────────────────────────────────────────────
  AI_CONCURRENCY: parseInt(process.env.AI_CONCURRENCY || '8', 10),

  // ── Auth ─────────────────────────────────────────────────────────────────────
  // Access token lifetime. The mobile app keeps only the access token and
  // refreshes it (POST /api/auth/refresh with the bearer token) once it is
  // older than 25 days, so the default must stay >= 30d unless the app changes.
  JWT_EXPIRES_IN:         process.env.JWT_EXPIRES_IN          || '30d'   ,
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN  || '60d'   ,  // Refresh token (single-use, rotated)

  // ── URLs ─────────────────────────────────────────────────────────────────────
  BASE_URL:       process.env.BASE_URL || process.env.CORS_ORIGIN || 'https://justicegavel.app',
  APP_SSO_REDIRECT: process.env.APP_SSO_REDIRECT || null,
  APP_OAUTH_REDIRECT: process.env.APP_OAUTH_REDIRECT || null,

  // ── Year 3: Integration provider OAuth credentials ───────────────────────────
  // Each provider requires CLIENT_ID + CLIENT_SECRET registered in their developer portal.
  // Leave blank to run in demo mode (mock responses, no live API calls).
  // CourtListener API (free at courtlistener.com — token optional, raises rate limits)
  courtlistener: {
    token:   process.env.COURTLISTENER_TOKEN   || null,
    enabled: process.env.COURTLISTENER_ENABLED !== 'false',
  },

  integrations: {
    imanage: {
      clientId:     process.env.IMANAGE_CLIENT_ID     || '',
      clientSecret: process.env.IMANAGE_CLIENT_SECRET || '',
    },
    netdocuments: {
      clientId:     process.env.NETDOCUMENTS_CLIENT_ID     || '',
      clientSecret: process.env.NETDOCUMENTS_CLIENT_SECRET || '',
    },
    clio: {
      clientId:     process.env.CLIO_CLIENT_ID     || '',
      clientSecret: process.env.CLIO_CLIENT_SECRET || '',
    },
    practicepanther: {
      clientId:     process.env.PRACTICEPANTHER_CLIENT_ID     || '',
      clientSecret: process.env.PRACTICEPANTHER_CLIENT_SECRET || '',
    },
    mycase: {
      clientId:     process.env.MYCASE_CLIENT_ID     || '',
      clientSecret: process.env.MYCASE_CLIENT_SECRET || '',
    },
    google_calendar: {
      clientId:     process.env.GOOGLE_CALENDAR_CLIENT_ID     || '',
      clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '',
    },
    outlook: {
      clientId:     process.env.OUTLOOK_CLIENT_ID     || '',
      clientSecret: process.env.OUTLOOK_CLIENT_SECRET || '',
    },
  },
};
// ── All environment variables used across the codebase ─────────────────────
// Grouped for Railway / Heroku dashboard clarity
export const ALL_ENV_VARS = {

  // ── Authentication ──────────────────────────────────────────────────────
  JWT_SECRET:               process.env.JWT_SECRET                 || '',
  JWT_REFRESH_SECRET:       process.env.JWT_REFRESH_SECRET         || '',
  ENCRYPTION_KEY:           process.env.ENCRYPTION_KEY             || '',
  JWT_EXPIRES_IN:           process.env.JWT_EXPIRES_IN             || '30d',
  JWT_REFRESH_EXPIRES_IN:   process.env.JWT_REFRESH_EXPIRES_IN     || '60d',
  AUTH_RATE_LIMIT:          process.env.AUTH_RATE_LIMIT            || '10',  // logins / 15 min
  REGISTER_RATE_LIMIT:      process.env.REGISTER_RATE_LIMIT        || '5',   // registrations / hour

  // ── Database ─────────────────────────────────────────────────────────────
  DATABASE_URL:             process.env.DATABASE_URL               || '',    // POSTGRES_URL accepted as alias
  PRODUCTION_DATABASE_URL:  process.env.PRODUCTION_DATABASE_URL    || '',    // staging only: the prod URL, so staging refuses to boot against it
  APP_ENV:                  process.env.APP_ENV                    || '',    // development | test | staging | production (default from NODE_ENV)
  POSTGRES_URL:             process.env.POSTGRES_URL               || '',    // alias of DATABASE_URL
  PGSSL:                    process.env.PGSSL                      || '',    // 'false' disables TLS to Postgres
  DB_LOG_ERRORS:            process.env.DB_LOG_ERRORS              || 'false',

  // ── AI ──────────────────────────────────────────────────────────────────
  ANTHROPIC_API_KEY:        process.env.ANTHROPIC_API_KEY          || '',
  CLAUDE_MODEL:             process.env.CLAUDE_MODEL               || 'claude-sonnet-4-6', // utils/ai.js
  ANTHROPIC_BASE_URL:       process.env.ANTHROPIC_BASE_URL         || '',    // test/mock override only
  AI_JOB_TIMEOUT_MS:        process.env.AI_JOB_TIMEOUT_MS          || '45000',
  AI_CONCURRENCY:           process.env.AI_CONCURRENCY             || '8',
  OPENAI_API_KEY:           process.env.OPENAI_API_KEY             || '',   // Whisper transcription
  AI_DAILY_BUDGET_USD:      process.env.AI_DAILY_BUDGET_USD        || '50',  // services/aiBudget.js: global daily AI spend cap ('off' disables)
  AI_BUDGET_ALERT_PCT:      process.env.AI_BUDGET_ALERT_PCT        || '80',  // SEV-2 alert at this share of the cap; SEV-1 at 100 %
  AI_PRICE_INPUT_PER_MTOK:  process.env.AI_PRICE_INPUT_PER_MTOK    || '',    // override the USD/1M input-token price used for metering
  AI_PRICE_OUTPUT_PER_MTOK: process.env.AI_PRICE_OUTPUT_PER_MTOK   || '',    // override the USD/1M output-token price used for metering

  // ── Admin ────────────────────────────────────────────────────────────────
  ADMIN_KEY:                process.env.ADMIN_KEY                  || '',
  ADMIN_EMAIL:              process.env.ADMIN_EMAIL                || '',
  ADMIN_ALERT_EMAIL:        process.env.ADMIN_ALERT_EMAIL          || '',
  ADMIN_ALERT_SMS:          process.env.ADMIN_ALERT_SMS            || '',
  ADMIN_PANEL_URL:          process.env.ADMIN_PANEL_URL            || '',
  ADMIN_URL:                process.env.ADMIN_URL                  || '',    // bar re-verification email links

  // ── Stripe ───────────────────────────────────────────────────────────────
  STRIPE_SECRET_KEY:        process.env.STRIPE_SECRET_KEY          || '',    // unset → billing 503 payments_unavailable
  STRIPE_SECRET:            process.env.STRIPE_SECRET              || '',    // legacy alias of STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET:    process.env.STRIPE_WEBHOOK_SECRET      || '',
  STRIPE_ACH_ENABLED:       process.env.STRIPE_ACH_ENABLED         || 'false',
  STRIPE_SUCCESS_URL:       process.env.STRIPE_SUCCESS_URL         || 'https://justicegavel.app/payment/success',
  STRIPE_CANCEL_URL:        process.env.STRIPE_CANCEL_URL          || 'https://justicegavel.app/payment/cancel',
  // Subscription price IDs (create in Stripe dashboard; routes/billing/_shared.js reads them).
  // No built-in fallbacks: a plan whose price id is unset cannot be purchased.
  STRIPE_LEGAL_PRO_PRICE_ID:      (process.env.STRIPE_LEGAL_PRO_PRICE_ID || ''),
  STRIPE_LEGAL_PRO_ANNUAL_ID:     (process.env.STRIPE_LEGAL_PRO_ANNUAL_ID || ''),
  STRIPE_ADVISOR_PRICE_ID:  (process.env.STRIPE_ADVISOR_PRICE_ID || ''),
  STRIPE_ADVISOR_ANNUAL_ID: (process.env.STRIPE_ADVISOR_ANNUAL_ID || ''),
  STRIPE_ESQUIRE_PRICE_ID: (process.env.STRIPE_ESQUIRE_PRICE_ID || ''),
  STRIPE_ESQUIRE_ANNUAL_ID:(process.env.STRIPE_ESQUIRE_ANNUAL_ID || ''),
  STRIPE_LEGAL_RADAR_ID: (process.env.STRIPE_LEGAL_RADAR_ID || ''),
  // Bondsman plan price IDs (routes/billing/_shared.js)
  STRIPE_BONDSMAN_STARTER_ID:        process.env.STRIPE_BONDSMAN_STARTER_ID        || '',
  STRIPE_BONDSMAN_STARTER_ANNUAL_ID: process.env.STRIPE_BONDSMAN_STARTER_ANNUAL_ID || '',
  STRIPE_BONDSMAN_PRO_ID:            process.env.STRIPE_BONDSMAN_PRO_ID            || '',
  STRIPE_BONDSMAN_PRO_ANNUAL_ID:     process.env.STRIPE_BONDSMAN_PRO_ANNUAL_ID     || '',
  STRIPE_BONDSMAN_MARKET_ID:         process.env.STRIPE_BONDSMAN_MARKET_ID         || '',
  STRIPE_BONDSMAN_MARKET_ANNUAL_ID:  process.env.STRIPE_BONDSMAN_MARKET_ANNUAL_ID  || '',

  // ── Email (Resend) ───────────────────────────────────────────────────────
  RESEND_API_KEY:           process.env.RESEND_API_KEY             || null,  // null disables email (logged instead)
  EMAIL_FROM:               process.env.EMAIL_FROM                 || 'noreply@justicegavel.app',
  ALERT_EMAIL_FROM:         process.env.ALERT_EMAIL_FROM           || 'alerts@justicegavel.app',
  ALERT_EMAIL:              process.env.ALERT_EMAIL                || '',    // ops alert recipient
  ALERT_WEBHOOK_URL:        process.env.ALERT_WEBHOOK_URL          || '',    // Slack incoming webhook
  ONCALL_EMAIL:             process.env.ONCALL_EMAIL               || '',
  ONCALL_EMAIL_2:           process.env.ONCALL_EMAIL_2             || '',
  LIVE_EMAIL:               process.env.LIVE_EMAIL                 || '',    // 'false' forces log-only even with RESEND_API_KEY

  // ── Google / Maps ────────────────────────────────────────────────────────
  GOOGLE_PLACES_KEY:        process.env.GOOGLE_PLACES_KEY          || '',
  GOOGLE_PLACES_MIN_INTERVAL_MS: process.env.GOOGLE_PLACES_MIN_INTERVAL_MS || '150',  // data refresh: min ms between Places requests
  GOOGLE_PLACES_MAX_REQUESTS:    process.env.GOOGLE_PLACES_MAX_REQUESTS    || '5000', // data refresh: Places request budget per run
  YELP_API_KEY:             process.env.YELP_API_KEY               || '',

  // ── Push (Expo + web push) ───────────────────────────────────────────────
  EXPO_ACCESS_TOKEN:        process.env.EXPO_ACCESS_TOKEN          || '',
  EXPO_PUSH_API_URL:        process.env.EXPO_PUSH_API_URL          || '',    // default https://exp.host/--/api/v2 (services/expoPush.js)
  REMINDERS_ENABLED:        process.env.REMINDERS_ENABLED          || 'true', // 'false' stops reminder delivery in this process
  VAPID_PUBLIC_KEY:         process.env.VAPID_PUBLIC_KEY           || '',
  VAPID_PRIVATE_KEY:        process.env.VAPID_PRIVATE_KEY          || '',
  VAPID_EMAIL:              process.env.VAPID_EMAIL                || '',

  // ── Alternative Payment Providers (all no-op without keys) ───────────────
  PAYPAL_CLIENT_ID:         process.env.PAYPAL_CLIENT_ID           || '',
  PAYPAL_SECRET:            process.env.PAYPAL_SECRET              || '',
  BRAINTREE_MERCHANT_ID:    process.env.BRAINTREE_MERCHANT_ID      || '',
  SQUARE_ACCESS_TOKEN:      process.env.SQUARE_ACCESS_TOKEN        || '',
  AUTHORIZE_NET_API_LOGIN_ID:process.env.AUTHORIZE_NET_API_LOGIN_ID|| '',
  AMAZON_PAY_PUBLIC_KEY_ID: process.env.AMAZON_PAY_PUBLIC_KEY_ID   || '',
  COINBASE_COMMERCE_API_KEY:process.env.COINBASE_COMMERCE_API_KEY  || '',
  BITPAY_TOKEN:             process.env.BITPAY_TOKEN               || '',
  NOWPAYMENTS_KEY:          process.env.NOWPAYMENTS_KEY            || '',
  LIVE_PAYMENTS:            process.env.LIVE_PAYMENTS              || 'false', // /api/pay orchestrator: real sessions only when 'true'

  // ── Integrations (OAuth apps; demo data without credentials) ─────────────
  CLIO_CLIENT_ID:                process.env.CLIO_CLIENT_ID                || '',
  CLIO_CLIENT_SECRET:            process.env.CLIO_CLIENT_SECRET            || '',
  MYCASE_CLIENT_ID:              process.env.MYCASE_CLIENT_ID              || '',
  MYCASE_CLIENT_SECRET:          process.env.MYCASE_CLIENT_SECRET          || '',
  PRACTICEPANTHER_CLIENT_ID:     process.env.PRACTICEPANTHER_CLIENT_ID     || '',
  PRACTICEPANTHER_CLIENT_SECRET: process.env.PRACTICEPANTHER_CLIENT_SECRET || '',
  IMANAGE_CLIENT_ID:             process.env.IMANAGE_CLIENT_ID             || '',
  IMANAGE_CLIENT_SECRET:         process.env.IMANAGE_CLIENT_SECRET         || '',
  NETDOCUMENTS_CLIENT_ID:        process.env.NETDOCUMENTS_CLIENT_ID        || '',
  NETDOCUMENTS_CLIENT_SECRET:    process.env.NETDOCUMENTS_CLIENT_SECRET    || '',
  GOOGLE_CALENDAR_CLIENT_ID:     process.env.GOOGLE_CALENDAR_CLIENT_ID     || '',
  GOOGLE_CALENDAR_CLIENT_SECRET: process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '',
  OUTLOOK_CLIENT_ID:             process.env.OUTLOOK_CLIENT_ID             || '',
  OUTLOOK_CLIENT_SECRET:         process.env.OUTLOOK_CLIENT_SECRET         || '',
  COURTLISTENER_TOKEN:           process.env.COURTLISTENER_TOKEN           || '',
  COURTLISTENER_ENABLED:         process.env.COURTLISTENER_ENABLED         || 'true',
  BASE_URL:                      process.env.BASE_URL                      || '', // this API's public URL (SAML/OAuth callbacks)
  APP_SSO_REDIRECT:              process.env.APP_SSO_REDIRECT              || '',
  APP_OAUTH_REDIRECT:            process.env.APP_OAUTH_REDIRECT            || '',

  // ── Supabase (attachments storage, RAG) ─────────────────────────────────
  SUPABASE_URL:             process.env.SUPABASE_URL               || '',
  SUPABASE_SERVICE_KEY:     process.env.SUPABASE_SERVICE_KEY       || '',

  // ── Error tracking (instrument.js) ───────────────────────────────────────
  SENTRY_DSN:                  process.env.SENTRY_DSN                  || '',
  SENTRY_ENVIRONMENT:          process.env.SENTRY_ENVIRONMENT          || '',
  SENTRY_RELEASE:              process.env.SENTRY_RELEASE              || '',
  SENTRY_TRACES_SAMPLE_RATE:   process.env.SENTRY_TRACES_SAMPLE_RATE   || '',
  SENTRY_PROFILES_SAMPLE_RATE: process.env.SENTRY_PROFILES_SAMPLE_RATE || '',
  SENTRY_PROFILING:            process.env.SENTRY_PROFILING            || '',

  // ── Infrastructure ───────────────────────────────────────────────────────
  REDIS_URL:                process.env.REDIS_URL                  || '',
  REPORT_DIR:               process.env.REPORT_DIR                 || '/tmp/reports',
  RATE_LIMIT_PER_MIN:       process.env.RATE_LIMIT_PER_MIN         || '200', // global per-IP limit (app.js)
  CORS_ORIGIN:              process.env.CORS_ORIGIN                || '',
  EXTRA_ORIGINS:            process.env.EXTRA_ORIGINS              || '',
  FRONTEND_URL:             process.env.FRONTEND_URL               || '',
  APP_URL:                  process.env.APP_URL                    || '',    // deep-link base for emails/redirects
  // Message attachments: local dir, Supabase Storage, or disabled
  ATTACHMENTS_STORAGE:      process.env.ATTACHMENTS_STORAGE        || '',    // off | local | supabase (auto when unset)
  ATTACHMENTS_DIR:          process.env.ATTACHMENTS_DIR            || '',    // default <app>/data/attachments
  ATTACHMENTS_BUCKET:       process.env.ATTACHMENTS_BUCKET         || 'case-documents',
  DAILY_API_KEY:            process.env.DAILY_API_KEY              || '',    // Daily.co video rooms (503 without)

  // ── Scheduler / Cron ─────────────────────────────────────────────────────
  REFRESH_CRON:             process.env.REFRESH_CRON               || '0 3 * * *',
  REFRESH_TZ:               process.env.REFRESH_TZ                 || 'America/Chicago',
  HEALTH_SCAN_CRON:         process.env.HEALTH_SCAN_CRON           || '0 2 * * *',
  LIVE_REFRESH:             process.env.LIVE_REFRESH               || 'false', // 'true' enables the data-refresh/outbound scheduler (not reminder delivery)

  // ── Arrest data ──────────────────────────────────────────────────────────
  ARREST_FEED_URLS:         process.env.ARREST_FEED_URLS           || '', // see services/arrest_ingest.js

  // ── Demo data ────────────────────────────────────────────────────────────
  SHOW_SAMPLE_ARRESTS:      process.env.SHOW_SAMPLE_ARRESTS        || 'false', // see utils/arrestVisibility.js

  // ── Logging ──────────────────────────────────────────────────────────────
  LOG_LEVEL:                process.env.LOG_LEVEL                  || 'info',

  // ── Runtime / platform ───────────────────────────────────────────────────
  PORT:                     process.env.PORT                       || '4000',
  DEMO_MODE:                process.env.DEMO_MODE                  || '',    // only 'true' counts in production
  // json | text. Production defaults to one-line JSON (utils/logger.js).
  LOG_FORMAT:               process.env.LOG_FORMAT                 || '',
  SCAN_QUIET:               process.env.SCAN_QUIET                 || 'false',
  SLOW_QUERY_MS:            process.env.SLOW_QUERY_MS              || '500', // db/index.js: warn on queries slower than this (0 = off)

  // ── Performance / ops tuning ─────────────────────────────────────────────
  PG_POOL_MAX:              process.env.PG_POOL_MAX                || '20',  // db/index.js pool size
  MEMORY_LIMIT_MB:          process.env.MEMORY_LIMIT_MB            || '512', // monitoring/selfHealing.js watchdog thresholds scale from this
  AI_DRAIN_TIMEOUT_MS:      process.env.AI_DRAIN_TIMEOUT_MS        || '10000', // graceful-shutdown wait for in-flight AI jobs
  HEALTH_CACHE_MS:          process.env.HEALTH_CACHE_MS            || '5000', // /health caches its DB probe this long

  // ── Runtime ──────────────────────────────────────────────────────────────
  NODE_ENV:                 process.env.NODE_ENV                   || 'development',
  RAILWAY_ENVIRONMENT:      process.env.RAILWAY_ENVIRONMENT        || '',
};



export const GAVEL_EMOJI = '⚖️';
