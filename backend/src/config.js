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

// ── Production gate ────────────────────────────────────────────────────────────
const REQUIRED_IN_PROD = [
  'ANTHROPIC_API_KEY',
  'STRIPE_SECRET',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
];
const DEMO_MODE = process.env.DEMO_MODE !== 'false';

if (!DEMO_MODE) {
  const missing = REQUIRED_IN_PROD.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('[config] ❌ Missing required env vars:', missing.join(', '));
    console.error('[config]    Add them to backend/.env — see .env.example');
    process.exit(1);
  }
}

// ── Optional features — degrade gracefully if absent ──────────────────────────
const OPTIONAL_WARNINGS = {
  // Existing infrastructure
  TWILIO_ACCOUNT_SID:    'SMS alerts disabled — emergency SOS will only email contacts',
  SENDGRID_API_KEY:      'Email alerts disabled — emergency SOS will only SMS contacts',
  SENTRY_DSN:            'Error tracking disabled — errors will only appear in PM2 logs',
  GOOGLE_PLACES_KEY:     'Google Places fallback disabled — GPS city lookup may fail',
  ADMIN_KEY:             'Admin API unprotected — set ADMIN_KEY to restrict provider DB access',
  STRIPE_WEBHOOK_SECRET: 'Stripe webhooks unverified — subscription events ignored',
  EXPO_ACCESS_TOKEN:     'Expo push enhanced delivery disabled — push still works via anonymous token',

  // Year 3: DMS integrations
  IMANAGE_CLIENT_ID:       'iManage OAuth disabled — connections use demo mode only',
  NETDOCUMENTS_CLIENT_ID:  'NetDocuments OAuth disabled — connections use demo mode only',

  // Year 3: Practice management integrations
  CLIO_CLIENT_ID:          'Clio Manage OAuth disabled — connections use demo mode only',
  PRACTICEPANTHER_CLIENT_ID: 'PracticePanther OAuth disabled — connections use demo mode only',
  MYCASE_CLIENT_ID:        'MyCase OAuth disabled — connections use demo mode only',

  // Year 3: Calendar integrations
  GOOGLE_CALENDAR_CLIENT_ID: 'Google Calendar OAuth disabled — CalDAV basic auth only',
  OUTLOOK_CLIENT_ID:         'Microsoft Outlook OAuth disabled — CalDAV basic auth only',
};

if (!DEMO_MODE) {
  for (const [key, msg] of Object.entries(OPTIONAL_WARNINGS)) {
    if (!process.env[key]) console.warn(`[config] ⚠️  ${key} not set — ${msg}`);
  }
}

// ── Exported configuration ─────────────────────────────────────────────────────
export const CONFIG = {
  DEMO_MODE,

  // ── Feature flags ────────────────────────────────────────────────────────────
  LIVE_PAYMENTS:  process.env.LIVE_PAYMENTS  === 'true',
  LIVE_SMS:       process.env.LIVE_SMS        === 'true',
  LIVE_EMAIL:     process.env.LIVE_EMAIL      === 'true',
  LIVE_REFRESH:   process.env.LIVE_REFRESH    === 'true',

  // ── Infrastructure ───────────────────────────────────────────────────────────
  POSTGRES_URL:   process.env.POSTGRES_URL    || '',
  USE_POSTGRES:   !!process.env.POSTGRES_URL,
  SENTRY_DSN:     process.env.SENTRY_DSN      || '',
  PORT:           parseInt(process.env.PORT   || '4000', 10),

  // ── AI ───────────────────────────────────────────────────────────────────────
  AI_CONCURRENCY: parseInt(process.env.AI_CONCURRENCY || '8', 10),

  // ── Auth ─────────────────────────────────────────────────────────────────────
  JWT_EXPIRES_IN:         process.env.JWT_EXPIRES_IN          || '15m'   ,  // Access token: 15 min
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN  || '7d'    ,  // Refresh token: 7 days,

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
  STRIPE_SECRET:            process.env.STRIPE_SECRET              || '',
  STRIPE_WEBHOOK_SECRET:    process.env.STRIPE_WEBHOOK_SECRET      || '',
  STRIPE_ACH_ENABLED:       process.env.STRIPE_ACH_ENABLED         || 'false',
  STRIPE_SUCCESS_URL:       process.env.STRIPE_SUCCESS_URL         || 'https://justicegavel.app/payment/success',
  STRIPE_CANCEL_URL:        process.env.STRIPE_CANCEL_URL          || 'https://justicegavel.app/payment/cancel',
  // Subscription price IDs (create in Stripe dashboard)
  STRIPE_LEGAL_PRO_PRICE_ID:      process.env.STRIPE_LEGAL_PRO_PRICE_ID        || '',
  STRIPE_LEGAL_PRO_ANNUAL_ID:     process.env.STRIPE_LEGAL_PRO_ANNUAL_ID       || '',
  STRIPE_ADVISOR_PRICE_ID:  process.env.STRIPE_ADVISOR_PRICE_ID    || '',
  STRIPE_ADVISOR_ANNUAL_ID: process.env.STRIPE_ADVISOR_ANNUAL_ID   || '',
  STRIPE_ESQUIRE_PRICE_ID: process.env.STRIPE_ESQUIRE_PRICE_ID   || '',
  STRIPE_ESQUIRE_ANNUAL_ID:process.env.STRIPE_ESQUIRE_ANNUAL_ID  || '',
  STRIPE_LEGAL_RADAR_ID: process.env.STRIPE_LEGAL_RADAR_ID   || '',

  // ── Twilio ───────────────────────────────────────────────────────────────
  TWILIO_ACCOUNT_SID:       process.env.TWILIO_ACCOUNT_SID         || '',
  TWILIO_AUTH_TOKEN:        process.env.TWILIO_AUTH_TOKEN          || '',
  TWILIO_FROM_NUMBER:       process.env.TWILIO_FROM_NUMBER         || '',

  // ── SendGrid ─────────────────────────────────────────────────────────────
  SENDGRID_API_KEY:         process.env.SENDGRID_API_KEY           || '',
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

  // ── Logging ──────────────────────────────────────────────────────────────
  LOG_LEVEL:                process.env.LOG_LEVEL                  || 'info',
  LOG_FORMAT:               process.env.LOG_FORMAT                 || 'combined',
  SCAN_QUIET:               process.env.SCAN_QUIET                 || 'false',

  // ── Runtime ──────────────────────────────────────────────────────────────
  NODE_ENV:                 process.env.NODE_ENV                   || 'development',
  RAILWAY_ENVIRONMENT:      process.env.RAILWAY_ENVIRONMENT        || '',
};


