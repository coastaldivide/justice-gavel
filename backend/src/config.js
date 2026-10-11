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
  // services/arrest_ingest.js and ENVIRONMENT_VARS.md for the exact shape.
  ARREST_FEED_URLS:      'Arrest ingestion disabled — POST /api/arrests/ingest has no feed to pull and arrest coverage is empty',
  // Default (unset/false) is the safe production setting. "true" is for demos only:
  // seeded sample arrest rows (source seed_v1 etc.) then appear in read-only arrest
  // views flagged is_sample:true / labelled "Sample record" in the app. They are
  // never alerted on, messaged about or sold, whatever this is set to.
  SHOW_SAMPLE_ARRESTS:   'Sample (seeded) arrest records are hidden from users (set SHOW_SAMPLE_ARRESTS=true only for demos)',
};

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
  if (IS_PROD && String(process.env.SHOW_SAMPLE_ARRESTS || '').trim().toLowerCase() === 'true') {
    logger.warn('[config] ⚠️  SHOW_SAMPLE_ARRESTS=true in production — generated sample arrest records are visible to users (labelled "Sample record"). Use for demos only.');
  }
  return { missing };
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
  ENCRYPTION_KEY:           process.env.ENCRYPTION_KEY             || '',

  // ── AI ──────────────────────────────────────────────────────────────────
  ANTHROPIC_API_KEY:        process.env.ANTHROPIC_API_KEY          || '',
  OPENAI_API_KEY:           process.env.OPENAI_API_KEY             || '',   // fallback provider

  // ── Admin ────────────────────────────────────────────────────────────────
  ADMIN_KEY:                process.env.ADMIN_KEY                  || '',
  ADMIN_EMAIL:              process.env.ADMIN_EMAIL                || '',
  ADMIN_ALERT_EMAIL:        process.env.ADMIN_ALERT_EMAIL          || '',
  ADMIN_ALERT_SMS:          process.env.ADMIN_ALERT_SMS            || '',
  ADMIN_PANEL_URL:          process.env.ADMIN_PANEL_URL            || '',

  // ── Stripe ───────────────────────────────────────────────────────────────
  STRIPE_SECRET:            process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET              || '',
  STRIPE_WEBHOOK_SECRET:    process.env.STRIPE_WEBHOOK_SECRET      || '',
  STRIPE_ACH_ENABLED:       process.env.STRIPE_ACH_ENABLED         || 'false',
  STRIPE_SUCCESS_URL:       process.env.STRIPE_SUCCESS_URL         || 'https://justicegavel.app/payment/success',
  STRIPE_CANCEL_URL:        process.env.STRIPE_CANCEL_URL          || 'https://justicegavel.app/payment/cancel',
  // Subscription price IDs (create in Stripe dashboard)
  STRIPE_LEGAL_PRO_PRICE_ID:      (process.env.STRIPE_LEGAL_PRO_PRICE_ID || 'price_1Tb1jc2XUfNqC3X4Iqzcz6lC'),
  STRIPE_LEGAL_PRO_ANNUAL_ID:     (process.env.STRIPE_LEGAL_PRO_ANNUAL_ID || 'price_1Tb1iJ2XUfNqC3X49Ycr9lti'),
  STRIPE_ADVISOR_PRICE_ID:  (process.env.STRIPE_ADVISOR_PRICE_ID || 'price_1Tb1hV2XUfNqC3X4QLiRdT22'),
  STRIPE_ADVISOR_ANNUAL_ID: (process.env.STRIPE_ADVISOR_ANNUAL_ID || 'price_1Tb1hV2XUfNqC3X4iMSFj1e1'),
  STRIPE_ESQUIRE_PRICE_ID: (process.env.STRIPE_ESQUIRE_PRICE_ID || 'price_1Tb1kY2XUfNqC3X4JMquJ8hX'),
  STRIPE_ESQUIRE_ANNUAL_ID:(process.env.STRIPE_ESQUIRE_ANNUAL_ID || 'price_1Tb1l32XUfNqC3X4BRSRCuQa'),
  STRIPE_LEGAL_RADAR_ID: (process.env.STRIPE_LEGAL_RADAR_ID || 'price_1Tb1vn2XUfNqC3X4U1jojSNW'),

        
  // ── SendGrid ─────────────────────────────────────────────────────────────
  RESEND_API_KEY:         process.env.RESEND_API_KEY           || null,  // null disables email
  ALERT_EMAIL_FROM:         process.env.ALERT_EMAIL_FROM           || 'alerts@justicegavel.app',

  // ── Google / Maps ────────────────────────────────────────────────────────
  GOOGLE_PLACES_KEY:        process.env.GOOGLE_PLACES_KEY          || '',
  YELP_API_KEY:             process.env.YELP_API_KEY               || '',

  // ── Expo Push ────────────────────────────────────────────────────────────
  EXPO_ACCESS_TOKEN:        process.env.EXPO_ACCESS_TOKEN          || '',
  VAPID_PUBLIC_KEY:         process.env.VAPID_PUBLIC_KEY           || '',

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

  // ── Infrastructure ───────────────────────────────────────────────────────
  REDIS_URL:                process.env.REDIS_URL                  || '',
  UPLOAD_DIR:               process.env.UPLOAD_DIR                 || '/tmp/uploads',
  PROVIDERS_DB:             process.env.PROVIDERS_DB               || '',
  REPORT_DIR:               process.env.REPORT_DIR                 || '/tmp/reports',
  BOT_WEBHOOK_BASE_URL:     process.env.BOT_WEBHOOK_BASE_URL       || '',

  // ── Scheduler / Cron ─────────────────────────────────────────────────────
  REFRESH_CRON:             process.env.REFRESH_CRON               || '0 3 * * *',
  REFRESH_TZ:               process.env.REFRESH_TZ                 || 'America/Chicago',
  HEALTH_SCAN_CRON:         process.env.HEALTH_SCAN_CRON           || '0 2 * * *',

  // ── Arrest data ──────────────────────────────────────────────────────────
  ARREST_FEED_URLS:         process.env.ARREST_FEED_URLS           || '', // see services/arrest_ingest.js

  // ── Demo data ────────────────────────────────────────────────────────────
  SHOW_SAMPLE_ARRESTS:      process.env.SHOW_SAMPLE_ARRESTS        || 'false', // see utils/arrestVisibility.js

  // ── Logging ──────────────────────────────────────────────────────────────
  LOG_LEVEL:                process.env.LOG_LEVEL                  || 'info',
  LOG_FORMAT:               process.env.LOG_FORMAT                 || 'combined',
  SCAN_QUIET:               process.env.SCAN_QUIET                 || 'false',

  // ── Runtime ──────────────────────────────────────────────────────────────
  NODE_ENV:                 process.env.NODE_ENV                   || 'development',
  RAILWAY_ENVIRONMENT:      process.env.RAILWAY_ENVIRONMENT        || '',
};



export const GAVEL_EMOJI = '⚖️';
