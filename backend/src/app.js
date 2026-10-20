import barPrepContentRouter from './routes/admin/barPrepContent.js';
import barPrepRouter        from './routes/barPrep.js';
import barVerifyRouter from './routes/admin/barVerification.js';
import impactRouter from './routes/impact.js';
import legalAidRouter from './routes/legalAid.js';
import bondsmanCRMRouter from './routes/bondsmanCRM.js';
import pretrialRouter from './routes/pretrial.js';
import caseLifecycleRouter from './routes/caseLifecycle.js';
import aiCostsRouter from './routes/admin/aiCosts.js';
// ── Sentry backend error tracking ─────────────────────────────────────────
import * as Sentry from '@sentry/node';
import hagueContactsRouter  from './routes/hague_contacts.js';
import logger, { runWithRequestContext } from './utils/logger.js';
import { APP_VERSION, GIT_COMMIT_SHORT } from './utils/version.js';
import express from 'express';
import helmet      from 'helmet';
import morgan      from 'morgan';
import responseTime from 'response-time';
import compression from 'compression';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import authRouter       from './routes/auth.js';
import alertsRouter     from './routes/alerts.js';
import arrestsRouter    from './routes/arrests.js';
import casesRouter      from './routes/cases.js';
import legaldataRouter from './routes/legaldata.js';
import courthousesRouter from './routes/courthouses.js';
import resourcesRouter  from './routes/resources.js';
import bailRouter       from './routes/bail.js';
import feedbackRouter   from './routes/feedback.js';
import payRouter        from './routes/pay.js';
import pushRouter       from './routes/push.js';
import providersRouter  from './routes/providers.js';
import insuranceRouter  from './routes/insurance.js';
import matchRouter      from './routes/match.js';
import advocacyRouter   from './routes/advocacy.js';
import { chatAccuracyMiddleware } from './middleware/legalAccuracy.js';
import chatRouter       from './routes/chat/index.js';
import lessonsRouter    from './routes/lessons.js';
import reviewsRouter    from './routes/reviews.js';
import messagesRouter   from './routes/messages.js';
import transcribeRouter from './routes/transcribe.js';
import motionsRouter    from './routes/motions/index.js';
import videoRouter    from './routes/video.js';
import researchRouter   from './routes/research.js';
import discoveryRouter  from './routes/discovery/index.js';
import translateRouter  from './routes/translate.js';
import adminRouter      from './routes/admin.js';
import savedRouter        from './routes/saved.js';
import consultationsRouter from './routes/consultations.js';
import checkinsRouter      from './routes/checkins.js';
import familyRouter       from './routes/family.js';
import rightsRouter       from './routes/rights.js';
import helpRouter         from './routes/help.js';
import courtDatesRouter   from './routes/courtDates.js';
import followingRouter    from './routes/following.js';
import expungementRouter   from './routes/expungement/index.js';
import immigrationRouter   from './routes/immigration.js';
import piLeadsRouter    from './routes/pi_leads.js';
import billingRouter    from './routes/billing/index.js';
import stripeWebhookRouter from './routes/webhooks/stripe.js';
import botAdminRouter      from './routes/webhooks/bot_admin.js';
import goldenGavelRouter     from './routes/golden_gavel.js';
import recoveryAgentsRouter  from './routes/recovery_agents.js';
import attorneyPlatformRouter from './routes/attorney/index.js';
import jobsRouter             from './routes/jobs.js';
import hpp from 'hpp';
import interrogationRouter from './routes/interrogation.js';
import mattersRouter from './routes/matters.js';
import matterIntelligenceRouter from './routes/matter_intelligence.js';
import firmAcquisitionRouter from './routes/firm_acquisition.js';
import firmVerticalsRouter from './routes/firm_verticals.js';
import firmsRouter from './routes/firms.js';
import auditRouter from './routes/audit.js';
import contractsRouter  from './routes/contracts/index.js';
import timeRouter       from './routes/time.js';
import docketRouter       from './routes/docket.js';
import privilegeRouter       from './routes/privilege.js';
import ssoRouter        from './routes/sso.js';
import conflictsRouter      from './routes/conflicts.js';
import integrationsRouter from './routes/integrations/index.js';
import dmsRouter          from './routes/integrations/dms.js';
import pmRouter           from './routes/integrations/practice-mgmt.js';
import caldavRouter       from './routes/integrations/caldav.js';
import recapRouter        from './routes/integrations/recap.js';
import webpushRouter      from './routes/webpush.js';
import outboundWHRouter   from './routes/webhooks/outbound.js';
import analyticsRouter     from './routes/analytics.js';
import searchRouter                 from './routes/search.js';
import { randomUUID } from 'crypto';
import forumRouter from './routes/forum.js';
import caseCounselRouter from './routes/caseCounsel.js';
import { stripeConfigured, APP_ENV } from './config.js';
import { aiConfigured } from './utils/ai.js';
import { getDb } from './db/index.js';
import { createDbHealthCheck } from './utils/healthCheck.js';
import { idempotency } from './middleware/idempotency.js';


// NOTE: Sentry is initialised once in ./instrument.js (imported first by
// server.js). Process-level handlers (signals, uncaught errors) live ONLY in
// server.js so importing this module (e.g. from tests) has no side effects
// beyond building the Express app.

const IS_PROD = process.env.NODE_ENV === 'production';
const app = express();

// ── Trust proxy — which X-Forwarded-For entry is the client (rate limits, guest
// report keys). Default: one hop (the platform edge). TRUST_PROXY overrides it
// with a hop count or a comma-separated list of trusted CIDRs; the client can
// never pick its own IP because only entries appended by trusted hops are used.
// The host's proxy chain is not documented (Render), so the right value is
// measured after deploy with GET /api/admin/diagnostics/client-ip (RUNBOOK
// "Client IP / TRUST_PROXY").
export function trustProxySetting(raw = process.env.TRUST_PROXY) {
  const v = String(raw ?? '').trim();
  if (!v) return 1;
  if (/^\d+$/.test(v)) return Number(v);
  if (/^(true|false)$/i.test(v)) return /^true$/i.test(v) ? 1 : false;   // never "trust everything"
  return v.split(',').map(x => x.trim()).filter(Boolean);
}
app.set('trust proxy', trustProxySetting());
app.set('etag', 'strong');

// ── Express 5: make req.query a writable own property ─────────────────────────
// Express 5 exposes req.query as a getter that re-parses on every access, so
// middleware such as hpp() and validateQuery() could not modify it.
app.use((req, _res, next) => {
  const q = req.query;
  Object.defineProperty(req, 'query', { value: { ...q }, writable: true, configurable: true, enumerable: true });
  next();
});

// ── /api/v1/* alias → /api/* ──────────────────────────────────────────────────
app.use((req, _res, next) => {
  if (req.url === '/api/v1' || req.url.startsWith('/api/v1/') || req.url.startsWith('/api/v1?')) {
    req.url = '/api' + req.url.slice('/api/v1'.length);
  }
  next();
});

// ── Request ID — correlate frontend errors with logs ─────────────────────────
app.use((req, res, next) => {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && /^[\w.-]{1,128}$/.test(incoming) ? incoming : randomUUID();
  req.id = id;
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  // Everything logged while this request is handled carries its request_id.
  runWithRequestContext({ requestId: id, method: req.method }, next);
});

// ── CORS — one configuration ──────────────────────────────────────────────────
// Allowed: production web origins, local dev origins, plus comma-separated
// CORS_ORIGIN / EXTRA_ORIGINS / FRONTEND_URL. Requests without an Origin header
// (native mobile apps, curl, server-to-server) are always allowed. Electron
// (file://, app://, "null") is allowed. Disallowed origins get 403 JSON.
const DEFAULT_ORIGINS = [
  'https://justicegavel.app',
  'https://www.justicegavel.app',
  'http://localhost:8081',
  'http://localhost:19006',
  'http://localhost:3000',
];
const splitList = (v) => String(v || '').split(',').map(o => o.trim().replace(/\/+$/, '')).filter(Boolean);
const ALLOWED_ORIGINS = new Set([
  ...DEFAULT_ORIGINS,
  ...splitList(process.env.CORS_ORIGIN),
  ...splitList(process.env.EXTRA_ORIGINS),
  ...splitList(process.env.FRONTEND_URL),
]);
const ALLOW_ANY_ORIGIN = ALLOWED_ORIGINS.has('*');

export function isOriginAllowed(origin) {
  if (!origin) return true;
  if (origin === 'null' || origin.startsWith('file://') || origin.startsWith('app://')) return true;
  if (ALLOW_ANY_ORIGIN || ALLOWED_ORIGINS.has(origin.replace(/\/+$/, ''))) return true;
  if (!IS_PROD) {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
    if (/\.exp\.direct$/.test(origin) || /\.tunnel\.exp\.host$/.test(origin)) return true;
  }
  return false;
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isOriginAllowed(origin)) return next();
  logger.warn({ origin, path: req.path }, '[CORS] blocked origin');
  return res.status(403).json({ error: 'cors_origin_not_allowed', message: 'Origin not allowed' });
});
const corsMiddleware = cors({
  origin: true,          // reflect — disallowed origins were rejected above
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  exposedHeaders: ['X-Request-ID', 'Idempotent-Replayed', 'X-Total-Count', 'X-Search-Matched'],
  maxAge: 86400,
});
app.use(corsMiddleware);

// ── Security headers (helmet) ─────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'"],
      styleSrc:       ["'self'", "'unsafe-inline'"],
      imgSrc:         ["'self'", 'data:', 'https:'],
      connectSrc:     ["'self'", 'https://api.anthropic.com',
                       'https://api.stripe.com', 'https://exp.host'],
      frameSrc:       ["'none'"],
      objectSrc:      ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts:                    { maxAge: 31536000, includeSubDomains: true, preload: true },
  noSniff:                 true,
  xssFilter:               true,
  referrerPolicy:          { policy: 'strict-origin-when-cross-origin' },
  permittedCrossDomainPolicies: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── Additional security headers not covered by helmet default ─────────────────
app.use((req, res, next) => {
  res.setHeader('X-API-Version', APP_VERSION);
  res.setHeader('Content-Security-Policy',
    "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self';"
  );
  res.setHeader('Permissions-Policy',
    'camera=(), microphone=(), geolocation=(self), payment=(self), usb=()'
  );
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.path.startsWith('/api/') && !req.path.includes('/providers')) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
});
app.use(compression());
app.use(responseTime((req, res, time) => {
  res.setHeader('X-Response-Time', time.toFixed(2) + 'ms');
}));
if (process.env.NODE_ENV !== 'test') {
  if (IS_PROD) {
    // One JSON object per line (Render log stream / Datadog-friendly). Logs req.path, never
    // the query string — search params can carry PII (names, emails, counties).
    app.use(morgan((tokens, req, res) => JSON.stringify({
      ts:         tokens.date(req, res, 'iso'),
      level:      'info',
      type:       'http',
      method:     tokens.method(req, res),
      // originalUrl, not req.path: by log time routing has rewritten req.path
      // to the router-relative path. Query string stripped — it can carry PII.
      path:       String(req.originalUrl || req.url || '').split('?')[0],
      status:     Number(tokens.status(req, res)) || 0,
      length:     Number(tokens.res(req, res, 'content-length')) || 0,
      ms:         Number(tokens['response-time'](req, res)) || 0,
      request_id: req.id,
    }), { skip: (req) => req.path === '/health' }));
  } else {
    app.use(morgan('dev'));
  }
}

// ── Stripe webhooks — RAW body, mounted BEFORE the JSON parser ────────────────
// Signature verification needs the exact bytes Stripe sent.
const STRIPE_WEBHOOK_PATHS = ['/webhooks/stripe', '/api/webhooks/stripe'];
app.use(STRIPE_WEBHOOK_PATHS, express.raw({ type: () => true, limit: '1mb' }), stripeWebhookRouter);
// Paths whose routers parse their own raw body (never run express.json on them)
const RAW_BODY_PATHS = new Set([...STRIPE_WEBHOOK_PATHS, '/api/billing/webhook']);

// ── JSON body parser (skips webhook paths) ────────────────────────────────────
const jsonParser = express.json({ limit: '1mb' });
app.use((req, res, next) => (RAW_BODY_PATHS.has(req.path) ? next() : jsonParser(req, res, next)));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ── HTTP Parameter Pollution protection ──────────────────────────────────────
app.use(hpp());

// ── Idempotency-Key on the create endpoints the app calls ────────────────────
// A retried POST (dropped connection, double submit) replays the first
// response instead of creating a duplicate. See middleware/idempotency.js.
app.use(idempotency());   // acts only on IDEMPOTENT_POST_PATHS

// ── Global rate limit ─────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_PER_MIN || '200', 10),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/webhooks/') || req.path === '/health',
});
app.use(limiter);

// ── Health check — real DB round-trip; 503 when the DB is down ───────────────
// /health is exempt from rate limiting, so the DB probe is cached (at most one
// SELECT 1 per HEALTH_CACHE_MS, default 5 s; concurrent requests share it).
// A failed probe is cached too and keeps answering 503. See utils/healthCheck.js.
export const checkDbHealth = createDbHealthCheck(getDb, {
  ttlMs: Math.max(0, parseInt(process.env.HEALTH_CACHE_MS || '5000', 10) || 0),
  onError: (e) => logger.warn({ err: e.message }, '[health] DB check failed'),
});

app.get(['/health', '/api/health'], async (req, res) => {
  const start = Date.now();
  const health = await checkDbHealth();
  const dbOk = health.ok;
  let queue = null;
  try {
    const { getQueueStats } = await import('./services/aiQueue.js');
    queue = getQueueStats ? getQueueStats() : null;
  } catch { /* queue stats optional */ }
  res.status(dbOk ? 200 : 503).json({
    ok:         dbOk,
    status:     dbOk ? 'ok' : 'degraded',
    db:         dbOk ? 'ok' : 'error',
    ts:         new Date().toISOString(),
    uptime_s:   Math.floor(process.uptime()),
    latency_ms: Date.now() - start,
    db_checked_at: new Date(health.checkedAt).toISOString(),
    db_cached:  health.cached,
    app:        'Justice Gavel',
    version:    APP_VERSION,
    commit:     GIT_COMMIT_SHORT,          // deployed commit (Render: RENDER_GIT_COMMIT), null locally
    mode:       process.env.DEMO_MODE === 'true' ? 'demo' : 'live',
    env:        APP_ENV,
    disclaimer_ver: '2026-01-01.1',
    queue,
    features: {
      ai:       aiConfigured(),
      payments: stripeConfigured(),
      email:    !!process.env.RESEND_API_KEY,
    },
  });
});

async function reminderMetrics() {
  const { getReminderStats } = await import('./services/reminderDispatcher.js');
  let undeliverable24h = null;
  try {
    const db = await getDb();
    const r = await db.get(`SELECT COUNT(*) AS n FROM scheduled_pushes WHERE status = 'undeliverable' AND deliver_at > NOW() - INTERVAL '1 day'`);
    undeliverable24h = Number(r?.n || 0);
  } catch { /* DB down → null */ }
  return { process: getReminderStats(), undeliverable_24h: undeliverable24h };
}

// ── /metrics — machine-readable operational metrics ────────────────────────────
// Used by: Uptime Robot, Datadog, Prometheus scrapers (the Render health check uses /health)
// Returns JSON by default; ?format=prometheus for Prometheus text format
app.get('/metrics', async (req, res) => {
  try {
    const memUsage = process.memoryUsage();
    const { getQueueStats } = await import('./services/aiQueue.js').catch(() => ({ getQueueStats: () => ({}) }));
    const stats = getQueueStats() || {};
    const queue = { pending: stats.pending ?? 0, running: stats.running ?? 0, completed: stats.done ?? 0, failed: stats.failed ?? 0 };
    // pg pool gauges — in-memory counters, no query issued
    let pool = null;
    try {
      const { getPoolStats } = await import('./db/index.js');
      pool = getPoolStats();
    } catch { /* pool stats optional */ }

    const metrics = {
      timestamp:       new Date().toISOString(),
      uptime_s:        Math.floor(process.uptime()),
      version:         APP_VERSION,
      commit:          GIT_COMMIT_SHORT,
      node_version:    process.version,
      memory: {
        rss_mb:        (memUsage.rss        / 1024 / 1024).toFixed(1),
        heap_used_mb:  (memUsage.heapUsed   / 1024 / 1024).toFixed(1),
        heap_total_mb: (memUsage.heapTotal  / 1024 / 1024).toFixed(1),
      },
      queue: {
        pending:   queue.pending   ?? 0,
        running:   queue.running   ?? 0,
        completed: queue.completed ?? 0,
        failed:    queue.failed    ?? 0,
      },
      // Connection pool: total/idle/waiting are live gauges; waiting > 0 means
      // requests are queueing for a connection. null on the sqlite dev fallback.
      db_pool: pool,
      // Scheduled jobs: runs / failures / skipped overlaps / last success (utils/cronGuard.js)
      jobs: (await import('./utils/cronGuard.js')).getJobStats(),
      // Court / user reminders: this process's delivery counters + reminders
      // that reached nobody in the last 24 h (all processes, from the table).
      reminders: await reminderMetrics(),
      process: {
        pid:       process.pid,
        platform:  process.platform,
        env:       process.env.NODE_ENV || 'unknown',
      },
    };

    // Prometheus text format (for Prometheus/Grafana scraping)
    if (req.query.format === 'prometheus') {
      const lines = [
        `# HELP jg_uptime_seconds Server uptime in seconds`,
        `# TYPE jg_uptime_seconds counter`,
        `jg_uptime_seconds ${metrics.uptime_s}`,
        `# HELP jg_memory_rss_bytes RSS memory in bytes`,
        `# TYPE jg_memory_rss_bytes gauge`,
        `jg_memory_rss_bytes ${memUsage.rss}`,
        `# HELP jg_queue_pending AI jobs pending`,
        `# TYPE jg_queue_pending gauge`,
        `jg_queue_pending ${metrics.queue.pending}`,
        `# HELP jg_queue_failed AI jobs failed`,
        `# TYPE jg_queue_failed counter`,
        `jg_queue_failed ${metrics.queue.failed}`,
        `# HELP jg_reminders_undeliverable_24h Reminders that reached no channel in the last 24 hours`,
        `# TYPE jg_reminders_undeliverable_24h gauge`,
        `jg_reminders_undeliverable_24h ${metrics.reminders.undeliverable_24h ?? 0}`,
        `# HELP jg_reminders_sent_total Reminders delivered by this process`,
        `# TYPE jg_reminders_sent_total counter`,
        `jg_reminders_sent_total ${metrics.reminders.process.sent}`,
        ...(pool ? [
          `# HELP jg_db_pool_total Open DB connections`,
          `# TYPE jg_db_pool_total gauge`,
          `jg_db_pool_total ${pool.total}`,
          `# HELP jg_db_pool_idle Idle DB connections`,
          `# TYPE jg_db_pool_idle gauge`,
          `jg_db_pool_idle ${pool.idle}`,
          `# HELP jg_db_pool_waiting Requests waiting for a DB connection`,
          `# TYPE jg_db_pool_waiting gauge`,
          `jg_db_pool_waiting ${pool.waiting}`,
        ] : []),
      ];
      res.set('Content-Type', 'text/plain; version=0.0.4');
      return res.send(lines.join('\n') + '\n');
    }

    res.json(metrics);
  } catch {
    res.status(500).json({ error: 'Could not collect metrics' });
  }
});

// ── API routes ────────────────────────────────────────────────────────────────
// Some routers (pretrial, legal-aid, impact, bondsman CRM, …) read req.db.
app.use('/api', async (req, _res, next) => {
  try { req.db = await getDb(); next(); } catch (e) { next(e); }
});
app.use('/api/auth',       authRouter);
app.use('/api/hague-contacts', hagueContactsRouter);
app.use('/api/alerts',     alertsRouter);
app.use('/api/arrests',    arrestsRouter);
app.use('/api/cases',      casesRouter);
app.use('/api/forum',      forumRouter);
app.use('/api/legaldata',  legaldataRouter);
app.use('/api/courthouses', courthousesRouter);
app.use('/api/resources',  resourcesRouter);
app.use('/api/bail',       bailRouter);
app.use('/api/feedback',   feedbackRouter);
app.use('/api/pay',        payRouter);
app.use('/api/push',       pushRouter);
app.use('/api/providers',  providersRouter);
app.use('/api/insurance',  insuranceRouter);
app.use('/api/match',      matchRouter);
app.use('/api/analytics',    analyticsRouter);
app.use('/api/advocacy',   advocacyRouter);
app.use('/api/chat',       chatAccuracyMiddleware, chatRouter);
app.use('/api/lessons',    lessonsRouter);
app.use('/api/search',         searchRouter);
app.use('/api/reviews',    reviewsRouter);
app.use('/api/messages',   messagesRouter);
app.use('/api/transcribe', transcribeRouter);
app.use('/api/interrogation', interrogationRouter);
app.use('/api/motions',    motionsRouter);
app.use('/api/video',    videoRouter);
app.use('/api/research',   researchRouter);
app.use('/api/discovery',  discoveryRouter);
app.use('/api/translate',  translateRouter);
app.use('/api/admin/ai-costs', aiCostsRouter);
app.use('/api/admin',      adminRouter);
app.use('/api/saved',        savedRouter);
app.use('/api/consultations', consultationsRouter);
app.use('/api/family', familyRouter);
app.use('/api/rights',      rightsRouter);      // core path step 1 (public)
app.use('/api/help',        helpRouter);        // core path step 2 (public)
app.use('/api/court-dates', courtDatesRouter);  // core path step 3
app.use('/api/following',   followingRouter);   // family followers
app.use('/api/checkins',      checkinsRouter);
app.use('/api/expungement',   expungementRouter);
app.use('/api/immigration',   immigrationRouter);
app.use('/api/contracts',     contractsRouter);
app.use('/api/sso',           ssoRouter);
app.use('/api/time',        timeRouter);
app.use('/api/docket',        docketRouter);
app.use('/api/privilege',        privilegeRouter);
app.use('/api/conflicts',     conflictsRouter);
app.use('/api/integrations',      integrationsRouter);
app.use('/api/integrations/dms',  dmsRouter);
app.use('/api/integrations/pm',   pmRouter);
app.use('/api/integrations/caldav', caldavRouter);
app.use('/api/integrations/recap',  recapRouter);
app.use('/api/webpush',             webpushRouter);


app.use('/api/webhooks/outbound', outboundWHRouter);
app.use('/api/matters',      mattersRouter);
app.use('/api/firms',         firmsRouter);
app.use('/api/firm-verticals', firmVerticalsRouter);
app.use('/api/firm-acquisition', firmAcquisitionRouter);
app.use('/api/matter-intelligence', matterIntelligenceRouter);
app.use('/api/audit',         auditRouter);
app.use('/api/pi-leads',  piLeadsRouter);
app.use('/api/billing',    billingRouter);

// ── Webhook routes ─────────────────────────────────────────────────────────────
app.use('/api/bot',          botAdminRouter);
app.use('/api/golden-gavel',  goldenGavelRouter);
app.use('/api/recovery-agents', recoveryAgentsRouter);
app.use('/api/attorney',       attorneyPlatformRouter);
app.use('/api/jobs',           jobsRouter);           // async AI job polling        // Bot monitoring + manual trigger

// ── Late-registered routes ────────────────────────────────────────────────────
app.use('/api/cases', caseLifecycleRouter);
app.use('/api/cases', caseCounselRouter);   // client-side counsel invites (C1)
app.use('/api/pretrial', pretrialRouter);
app.use('/api/bondsman', bondsmanCRMRouter);
app.use('/api/legal-aid', legalAidRouter);
app.use('/api/impact', impactRouter);
app.use('/api/admin/bar-verification', barVerifyRouter);
app.use('/api/admin/bar-prep', barPrepContentRouter);
app.use('/api/bar-prep',       barPrepRouter);

// ── Sentry error handler (no-op unless SENTRY_DSN set) ───────────────────────
if (process.env.SENTRY_DSN && typeof Sentry.setupExpressErrorHandler === 'function') {
  Sentry.setupExpressErrorHandler(app);
}

// ── 404 — route not found ────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error:  'Not found',
    path:   req.path,
    method: req.method,
    hint:   'Check the API documentation for valid endpoints.',
  });
});

// ── Global error handler ─────────────────────────────────────────────────────
 
app.use((err, req, res, _next) => {
  let status = err.status || err.statusCode || 500;
  if (err.type === 'entity.parse.failed') status = 400;
  const message = IS_PROD && status >= 500
    ? 'An unexpected error occurred. Our team has been notified.'
    : err.message || 'Internal server error';

  if (status >= 500) {
    logger.error({
      status,
      err:    err.message,
      code:   err.code,
      path:   req.path,
      method: req.method,
      stack:  err.stack?.split('\n').slice(0, 5).join(' | '),
    }, '[global_error]');
  }

  if (!res.headersSent) {
    res.status(status).json({
      error:   message,
      status,
      path:    req.path,
      request_id: req.id,
      ...(IS_PROD ? {} : { stack: err.stack?.split('\n').slice(0, 4) }),
    });
  }
});

export default app;
