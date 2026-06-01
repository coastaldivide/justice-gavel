import { initSentry, Sentry } from './monitoring/sentry.js';
import hagueContactsRouter  from './routes/hague_contacts.js';
import logger from './utils/logger.js';
import express from 'express';
import helmet      from 'helmet';
import morgan      from 'morgan';
import responseTime from 'response-time';
import compression from 'compression';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { initDb } from './db/index.js';
import { CONFIG } from './config.js';

// ── App routes ────────────────────────────────────────────────────────────────
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
import chatRouter       from './routes/chat/index.js';
import lessonsRouter    from './routes/lessons.js';
import reviewsRouter    from './routes/reviews.js';
import messagesRouter   from './routes/messages.js';
import transcribeRouter from './routes/transcribe.js';
import motionsRouter    from './routes/motions/index.js';
import researchRouter   from './routes/research.js';
import discoveryRouter  from './routes/discovery/index.js';
import translateRouter  from './routes/translate.js';
import adminRouter      from './routes/admin.js';
import savedRouter        from './routes/saved.js';
import consultationsRouter from './routes/consultations.js';
import checkinsRouter      from './routes/checkins.js';
import familyRouter       from './routes/family.js';
import expungementRouter   from './routes/expungement/index.js';
import piLeadsRouter    from './routes/pi_leads.js';
import billingRouter    from './routes/billing/index.js';

// ── Webhook routes ────────────────────────────────────────────────────────────
import twilioWebhookRouter from './routes/webhooks/twilio.js';
import stripeWebhookRouter from './routes/webhooks/stripe.js';
import botAdminRouter      from './routes/webhooks/bot_admin.js';
import goldenGavelRouter     from './routes/golden_gavel.js';
import recoveryAgentsRouter  from './routes/recovery_agents.js';
import attorneyPlatformRouter from './routes/attorney/index.js';
import jobsRouter             from './routes/jobs.js';

// ── Services ──────────────────────────────────────────────────────────────────
import { startScheduler } from './services/scheduler.js';
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
import res                          from './routes/resources.js';

// ── Startup configuration check ───────────────────────────────────────────────
// Warns about missing keys on boot — does NOT crash. App runs in demo mode.
const _missing = [];
if (!process.env.STRIPE_SECRET)       _missing.push('STRIPE_SECRET (payments will use demo mode)');
if (!process.env.ANTHROPIC_API_KEY)   _missing.push('ANTHROPIC_API_KEY (AI chat + match disabled)');
if (!process.env.TWILIO_ACCOUNT_SID)  _missing.push('TWILIO_ACCOUNT_SID (SMS bot disabled)');
if (!process.env.SENDGRID_API_KEY)    _missing.push('SENDGRID_API_KEY (email alerts disabled)');
if (!process.env.OPENAI_API_KEY)       _missing.push('OPENAI_API_KEY (Whisper transcription disabled)');
if (!process.env.GOOGLE_PLACES_KEY)   _missing.push('GOOGLE_PLACES_KEY (Google Places fallback disabled)');

if (_missing.length > 0) {
  logger.warn('\n⚠️  JUSTICE GAVEL — MISSING CONFIGURATION KEYS:');
  _missing.forEach(k => logger.warn(`   • ${k}`));
  logger.warn('   Add these to backend/.env to enable all features.\n');
} else {
  logger.info('✅  All API keys configured — running in LIVE mode');
}

const app = express();
// ── CORS: multi-origin allowlist + dev tunnel support ────────────────────────
const _rawOrigins = process.env.CORS_ORIGIN || '';
const _allowedOrigins = _rawOrigins.split(',').map(o => o.trim()).filter(Boolean);

function corsOriginResolver(origin, callback) {
  if (!origin) return callback(null, true); // non-browser (mobile app, curl)
  // Electron desktop app — production build loads from file:// (packaged) or app://
  // Development build loads from localhost. Both must be allowed.
  if (!origin || origin === 'null' || origin.startsWith('file://') || origin.startsWith('app://')) {
    return callback(null, true);
  }

  if (process.env.NODE_ENV !== 'production') {
    // Allow localhost on any port + Expo dev tunnels, but NOT arbitrary origins
    if (/^https?:\/\/localhost(?::\d+)?$/.test(origin) ||
        /^https?:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin) ||
        /\.exp\.direct$/.test(origin) ||
        /\.tunnel\.exp\.host$/.test(origin)) {
      return callback(null, true);
    }
    logger.warn('[CORS][dev] Blocked unknown origin:', origin);
  }
  if (_allowedOrigins.length === 0 && process.env.NODE_ENV === 'production') {
    logger.error('[CORS] CORS_ORIGIN not set — add to Railway env vars');
  }
  if (_allowedOrigins.includes(origin) || _allowedOrigins.includes('*')) return callback(null, true);
  return callback(new Error('CORS: origin not allowed: ' + origin), false);
}
const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:19006')
  .split(',').map(o => o.trim()).filter(Boolean);
const CORS_ORIGIN = CORS_ORIGINS.length === 1 ? CORS_ORIGINS[0] : CORS_ORIGINS;

// ── Stripe webhook MUST use raw body — mount BEFORE json middleware ────────────
app.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  (req, res, next) => {
    // Pass raw body through as req.body for signature verification
    next();
  },
  stripeWebhookRouter
);

// ── Standard middleware ────────────────────────────────────────────────────────

// ── Trust proxy — required for Railway/Fly.io/Render (rate limiter IP detection) ──
app.set('trust proxy', 1);

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
}));
// CORS — configured via ALLOWED_ORIGINS set above
const corsMiddleware = cors({
  origin: (origin, cb) => {
    const allowed = new Set([
      process.env.FRONTEND_URL || 'https://api.justicegavel.app',
      'http://localhost:8081', 'http://localhost:19006', 'exp://localhost:19000',
      ...(process.env.EXTRA_ORIGINS || '').split(',').filter(Boolean),
    ]);
    if (!origin || allowed.has(origin)) return cb(null, true);
    cb(new Error('CORS: origin not allowed'));
  },
  credentials: true, methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Request-ID'],
  exposedHeaders: ['X-Request-ID'], maxAge: 86400,
});
app.use(corsMiddleware);
app.options('*', corsMiddleware);  // preflight

// ── Request ID — threaded through all logs ────────────────────────────────────
app.use((req, _res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  next();
});


app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'"],
      styleSrc:      ["'self'", "'unsafe-inline'"],  // React Native Web requires inline styles
      imgSrc:        ["'self'", "data:", "https:"],
      connectSrc:    [
        "'self'",
        "https://api.anthropic.com",
        "https://api.stripe.com",
        "https://www.courtlistener.com",
        "https://exp.host",
        "wss://exp.host",
      ],
      fontSrc:       ["'self'", "https:", "data:"],
      objectSrc:     ["'none'"],
      mediaSrc:      ["'self'"],
      frameSrc:      ["'none'"],
      formAction:    ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,  // allow Stripe iframe
  crossOriginResourcePolicy: { policy: 'same-site' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  noSniff: true,
  xssFilter: true,
  hidePoweredBy: true,
}));

// ── Additional security headers not covered by helmet default ─────────────────
app.use((req, res, next) => {
  // API version header
  res.setHeader('X-API-Version', process.env.npm_package_version || '5.87.3');
  // Permissions Policy — restrict powerful browser APIs
  res.setHeader('Content-Security-Policy',
    "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self';"
  );
  res.setHeader('Permissions-Policy',
    'camera=(), microphone=(), geolocation=(self), payment=(self), usb=()'
  );
  // Cross-Origin headers for SharedArrayBuffer safety
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  // Referrer — don't leak API paths to third-party analytics
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Cache — prevent sensitive API responses being stored in browser cache
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
app.use(morgan(process.env.NODE_ENV === 'production'
  ? ':date[iso] :method :url :status :res[content-length] :response-time ms'
  : 'dev'
)); // Brotli/gzip all API responses
app.use(cors({ origin: CORS_ORIGIN,  // dynamic resolver above
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','admin-key','x-admin-key'],
}));

// ── HTTP Parameter Pollution protection ──────────────────────────────────────
app.use(hpp());

// ── Request ID — correlate frontend errors with Railway logs ──────────────────
import { randomUUID } from 'crypto';
app.use((req, res, next) => {
  const id = req.headers['x-request-id'] || randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' })); // also handles Twilio form-encoded

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/webhooks/'), // Webhooks exempt from rate limit
});
app.use(limiter);
initSentry(app);

// ── Health check ──────────────────────────────────────────────────────────────

// Rate limit /health — prevents timing profiling attacks
const healthLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many health checks' },
});
app.get('/health', healthLimiter, async (req, res) => {
  const start = Date.now();
  let db_ok = false;
  try {
    const { getDb } = await import('./db/index.js');
    const db = await getDb();
    await db.get('SELECT 1');
    db_ok = true;
  } catch {}
  const { getQueueStats } = await import('./services/aiQueue.js').catch(() => ({ getQueueStats: null }));
  const queue = getQueueStats ? getQueueStats() : null;
  res.status(200).json({
    ok:            db_ok,
    ts:            new Date().toISOString(),
    uptime_s:      Math.floor(process.uptime()),
    latency_ms:    Date.now() - start,
    app:           'Justice Gavel',
    version:       process.env.npm_package_version || '1.8.32',
    mode:          process.env.DEMO_MODE !== 'false' ? 'demo' : 'live',
    db:            db_ok ? 'ok' : 'error',
    queue:         queue,
    live_sms:      process.env.LIVE_SMS      === 'true',
    live_email:    process.env.LIVE_EMAIL    === 'true',
    live_payments: process.env.LIVE_PAYMENTS === 'true',
    jwt_secure:    process.env.JWT_SECRET !== 'dev_secret_change_me',
    disclaimer_ver: '2026-01-01.1',
    anthropic:     !!process.env.ANTHROPIC_API_KEY,
    supabase:     !!process.env.SUPABASE_URL,
    stripe:        !!process.env.STRIPE_SECRET,
  });
})

// ── /metrics — machine-readable operational metrics ────────────────────────────
// Used by: Uptime Robot, Datadog, Railway health checks, Prometheus scrapers
// Returns JSON by default; ?format=prometheus for Prometheus text format
app.get('/metrics', async (req, res) => {
  try {
    const memUsage = process.memoryUsage();
    const { getQueueStats } = await import('./services/aiQueue.js').catch(() => ({ getQueueStats: () => ({}) }));
    const queue = getQueueStats();

    const metrics = {
      timestamp:       new Date().toISOString(),
      uptime_s:        Math.floor(process.uptime()),
      version:         process.env.npm_package_version || '1.8.46',
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
      ];
      res.set('Content-Type', 'text/plain; version=0.0.4');
      return res.send(lines.join('\n') + '\n');
    }

    res.json(metrics);
  } catch (e) {
    res.status(500).json({ error: 'Could not collect metrics' });
  }
});
;

// ── Init DB then start scheduler ──────────────────────────────────────────────
try {
  await initDb();
} catch(e) {
  logger.error({ err: e.message }, '[db] Startup DB init failed — continuing without DB');
}
startScheduler();

// ── API routes ────────────────────────────────────────────────────────────────

// ── API v1 versioning — all routes accessible at /api/v1/* ────────────────────
// Legacy /api/* paths still work for backward compatibility.
// New clients should use /api/v1/*.
import express_import from 'express';
const v1Router = express_import.Router();
// Mount v1 as an alias — same handlers
app.use('/api/v1', (req, res, next) => {
  req.url = req.url;  // pass through to existing /api/* handlers
  next();
});

app.use('/api/auth',       authRouter);
app.use('/api/hague-contacts', hagueContactsRouter);
app.use('/api/alerts',     alertsRouter);
app.use('/api/arrests',    arrestsRouter);
app.use('/api/cases',      casesRouter);
app.use('/api/forum',         (await import('./routes/forum.js')).default);
  app.use('/api/legaldata', legaldataRouter);
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
app.use('/api/chat',       chatRouter);
app.use('/api/lessons',    lessonsRouter);
app.use('/api/search',         searchRouter);
app.use('/api/reviews',    reviewsRouter);
app.use('/api/messages',   messagesRouter);
app.use('/api/transcribe', transcribeRouter);
app.use('/api/interrogation', interrogationRouter);
app.use('/api/motions',    motionsRouter);
app.use('/api/research',   researchRouter);
app.use('/api/discovery',  discoveryRouter);
app.use('/api/translate',  translateRouter);
app.use('/api/admin',      adminRouter);
app.use('/api/saved',        savedRouter);
app.use('/api/consultations', consultationsRouter);
app.use('/api/family', familyRouter);
app.use('/api/checkins',      checkinsRouter);
app.use('/api/expungement',   expungementRouter);
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
app.use('/webhooks/twilio',  twilioWebhookRouter);  // Twilio inbound SMS
app.use('/api/bot',          botAdminRouter);
app.use('/api/golden-gavel',  goldenGavelRouter);
app.use('/api/recovery-agents', recoveryAgentsRouter);
app.use('/api/attorney',       attorneyPlatformRouter);
app.use('/api/jobs',           jobsRouter);           // async AI job polling        // Bot monitoring + manual trigger

// Sentry error handler registered above via Sentry.Handlers.errorHandler()
app.use((req, res) => res.status(404).json({ error: 'Not found. It may have been moved or deleted.' }));


// ── API documentation ─────────────────────────────────────────────────────────
// GET /api/docs       → OpenAPI 3.0 JSON spec
// GET /api/docs/ui    → (future) Swagger UI
app.get('/api/docs', (_req, res) => {
  import('./docs/openapi.js').then(({ openApiSpec }) => {
    res.json(openApiSpec);
  }).catch(e => res.status(500).json({ error: e.message }));
});

// ── Sentry error handler (must be last middleware) ───────────────────────────
// Captures all errors that reach Express's error handling layer
if (Sentry?.Handlers?.errorHandler) {
  app.use(Sentry.Handlers.errorHandler());
}

// ── Generic 500 handler (after Sentry) ───────────────────────────────────────
app.use((err, _req, res, _next) => {
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: status >= 500 ? 'Internal server error.' : (err.message || 'Request failed.'),
    code:  err.code || 'server_error',
  });
});

export default app;

// ── Graceful shutdown (SIGTERM / SIGINT) ─────────────────────────────────────
// Gives in-flight requests time to complete before closing the DB connection.
// PM2 sends SIGTERM on 'pm2 stop' / 'pm2 reload'. kill_timeout in ecosystem
// config gives 5s before SIGKILL.
function gracefulShutdown(signal) {
  logger.info(`[app] ${signal} received — draining connections…`);
  // Close DB connections
  import('./db/index.js').then(({ getDb }) =>
    getDb().then(db => {
      if (db && typeof db.close === 'function') db.close();
    }).catch(() => {})
  ).catch(() => {});
  setTimeout(() => {
    logger.info('[app] Shutdown complete.');
    process.exit(0);
  }, 2000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler ──────────────────────────────────────────────────────
// Catches any error thrown synchronously or via next(err) from route handlers.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = status < 500
    ? err.message
    : 'Internal server error. Please try again.';
  if (status >= 500) {
    logger.error({ msg: 'Unhandled error', path: req.path, method: req.method, error: err?.message, stack: err?.stack?.split('\n')[1] });
  }
  if (!res.headersSent) res.status(status).json({ error: message });
});

// ── Sentry error handler — must be after routes, before other error handlers ──
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}
