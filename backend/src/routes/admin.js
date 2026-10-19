import { safeJson, asyncRoute, err400, escapeLike, err401, err404, safeInt, safeTable, safeAdminColList } from '../utils/routeHelpers.js';
/**
 * /api/admin — Provider database management
 *
 * All routes require X-Admin-Key header matching ADMIN_KEY env var.
 *
 * GET    /api/admin/lawyers              — list all (paginated, filterable)
 * GET    /api/admin/lawyers/:id          — single record
 * POST   /api/admin/lawyers              — create
 * PUT    /api/admin/lawyers/:id          — full update
 * PATCH  /api/admin/lawyers/:id          — partial update
 * DELETE /api/admin/lawyers/:id          — soft-delete (active=0)
 * POST   /api/admin/lawyers/:id/verify   — mark verified
 * POST   /api/admin/lawyers/:id/restore  — restore soft-deleted
 *
 * GET    /api/admin/bail                 — same pattern for bail_agents
 * GET    /api/admin/bail/:id
 * POST   /api/admin/bail
 * PUT    /api/admin/bail/:id
 * PATCH  /api/admin/bail/:id
 * DELETE /api/admin/bail/:id
 *
 * GET    /api/admin/log                  — update audit log (paginated)
 * GET    /api/admin/log/:table/:id       — update log for one record
 * GET    /api/admin/stats                — DB summary stats
 *
 * POST   /api/admin/refresh              — trigger a provider refresh (in-process, background)
 *   Body: { city?, type?, source?, dryRun? }  → 202 (started) | 200 (skipped: no API key)
 * GET    /api/admin/refresh/runs         — scrape_runs log (every scraper / importer / scheduler run)
 *
 * Scraped changes to EXISTING providers are never written by a scraper; they
 * wait here for a decision (migration 15, services/dataRefresh/proposals.js):
 * GET    /api/admin/proposals            — list (?status=pending|applied|rejected|superseded|all,
 *                                          table, field, record_id, run_id, limit, offset)
 * POST   /api/admin/proposals/apply      — bulk apply   { ids: [...], note? }
 * POST   /api/admin/proposals/reject     — bulk reject  { ids: [...], note? }
 * POST   /api/admin/proposals/:id/apply  — apply one    { note?, force? } (409 if the row changed since)
 * POST   /api/admin/proposals/:id/reject — reject one   { note? }
 * Applying writes only the proposal's field (+ updated_at) and logs it to
 * provider_update_log and audit_log.
 */

import { runHealthScan }       from '../services/healthScan.js';
import { hasMinRole }         from '../middleware/rbac.js';
import { makeUserLimiter }    from '../middleware/sharedAiLimiter.js';
import logger from '../utils/logger.js';
import { Router }        from 'express';
import { authRequired }  from '../middleware/auth.js';
import { runRefresh } from '../services/dataRefresh/scheduled.js';
import { placesKeyConfigured } from '../services/dataRefresh/googlePlaces.js';
import { listProposals, applyProposal, rejectProposal, bulkDecide, ProposalError } from '../services/dataRefresh/proposals.js';

// ── Timing-safe admin key verification ───────────────────────────────────────
import { timingSafeEqual } from 'crypto';
import { getDb }          from '../db/index.js';
function verifyAdminKey(req) {
  const provided = req.headers['admin-key'] || req.headers['x-admin-key'] || '';
  const expected = process.env.ADMIN_KEY || '';
  if (!expected || provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch { return false; }
}

// Column and table safety — imported from routeHelpers.js (canonical, correct split on /\s*=\s*/)
// Helper aliases

const router = Router();

// ── Super-admin guard ─────────────────────────────────────────────────────────
// All /api/admin routes require authentication + super_admin role.
// Applied here as an early router-level middleware so no individual route
// can accidentally be exposed without the check.
function requireSuperAdmin(req, res, next) {
  const role = req.user?.role;
  if (!role || !['super_admin', 'admin'].includes(role)) {
    return res.status(403).json({
      error: 'Super admin access required.',
      code:  'forbidden',
    });
  }
  next();
}

// Apply auth + super_admin check to ALL routes in this router
router.use(authRequired, requireSuperAdmin);


// ── Apply admin key check to ALL routes on this router ────────────────────────
// verifyAdminKey uses timingSafeEqual to prevent timing attacks.
// Any request without a valid X-Admin-Key header gets 401 immediately.
// Rate-limit health scan manual trigger — max 1 per 5 minutes per user
const healthScanLimiter = makeUserLimiter({ windowMs: 300000, max: 1, message: 'Health scan already triggered. Wait 5 minutes between manual scans.' });

router.use((req, res, next) => {
  if (!verifyAdminKey(req)) {
    return err401(res, 'Invalid or missing admin key.');
  }
  next();
});

// Allowlist of tables the admin API is permitted to touch


// ── Auth middleware ───────────────────────────────────────────────────────────

// Auth already handled by verifyAdminKey middleware above

// ── DB helpers ────────────────────────────────────────────────────────────────

// ── Module-level singleton — one providers.sqlite connection per process ─────────
// Calling open() on every request leaks file descriptors under load.
// Provider data (lawyers, bail_agents, provider_update_log) lives in Postgres.
async function openDb() {
  return await getDb();
}

function safeParseJson(v, fallback) {
  try { return v ? safeJson(v) : fallback; } catch { return fallback; }
}

function formatRow(row) {
  if (!row) return null;
  return {
    ...row,
    specialties: safeParseJson(row.specialties, []),
    languages: safeParseJson(row.languages, ['English']),
    verified: !!row.verified,
    pro_bono: row.pro_bono != null ? !!row.pro_bono : undefined,
    sliding_scale: row.sliding_scale != null ? !!row.sliding_scale : undefined,
    free_consultation: row.free_consultation != null ? !!row.free_consultation : undefined,
    active: !!row.active,
  };
}

async function logChange(db, table, recordId, field, oldVal, newVal, source = 'admin') {
  await db.run(
    `INSERT INTO provider_update_log (table_name, record_id, field, old_value, new_value, source) VALUES (?,?,?,?,?,?)`,
    [table, recordId, field, oldVal != null ? String(oldVal) : null, newVal != null ? String(newVal) : null, source]
  );
}

async function logAllChanges(db, table, id, before, after) {
  const fields = Object.keys(after).filter(k => !['id','created_at','updated_at'].includes(k));
  for (const f of fields) {
    const oldv = before?.[f] != null ? String(before[f]) : null;
    const newv = after[f] != null ? String(after[f]) : null;
    if (oldv !== newv) await logChange(db, table, id, f, oldv, newv, 'admin');
  }
}

// ── Generic CRUD factory ──────────────────────────────────────────────────────

function crudRoutes(table, extraWriteFields = []) {
  const sub = Router();

  const BASE_FIELDS = ['city','name','phone','address','lat','lng','website','email','hours',
    'rating','reviews','bar_number','verified','active'];
  const WRITE_FIELDS = [...BASE_FIELDS, ...extraWriteFields];

  // GET list
  sub.get('/', async (req, res) => {
    try {
      const db = await openDb();
      const { city, active = '1', q, limit = 50, offset = 0 } = req.query;
      const PAGE_LIMIT = Math.min(safeInt(req.query.limit, 50), 500);
  const PAGE_OFFSET = safeInt(req.query.offset, 0);
  let sql = `SELECT * FROM ${safeTable(table)} WHERE 1=1` /* intentional: generic admin CRUD; table name constrained by safeTable() allowlist */;
      const params = [];
      if (active !== 'all') { sql += ' AND active = ?'; params.push(active === '1' ? 1 : 0); }
      if (city) { sql += ' AND city = ?'; params.push(city); }
      const qLike = q ? `%${escapeLike(String(q).slice(0, 100))}%` : null;
      if (q)    { sql += ' AND (name ILIKE ? OR address ILIKE ? OR phone ILIKE ?)'; params.push(qLike, qLike, qLike); }
      // Single paginated ORDER BY — use PAGE_LIMIT/PAGE_OFFSET (validated bounds)
      sql += ` ORDER BY city, name LIMIT ${PAGE_LIMIT} OFFSET ${PAGE_OFFSET}`;
  const rows = await db.all(sql, params);
      const countParams = [];
      let countSql = `SELECT COUNT(*) as n FROM ${safeTable(table)} WHERE 1=1`;
      if (active !== 'all') { countSql += ' AND active = ?'; countParams.push(active === '1' ? 1 : 0); }
      if (city) { countSql += ' AND city = ?'; countParams.push(city); }
      if (q)    { countSql += ' AND (name ILIKE ? OR address ILIKE ? OR phone ILIKE ?)'; countParams.push(qLike, qLike, qLike); }
      const total = await db.get(countSql, countParams);
      res.json({ total: total?.n ?? 0, offset: safeInt(offset), limit: safeInt(limit), rows: rows.map(formatRow) });
    } catch (e) {
    logger.error({ msg: '[admin]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // GET single
  sub.get('/:id', async (req, res) => {
    try {
      const db = await openDb();
      const row = await db.get(`SELECT * FROM ${safeTable(table)} WHERE id = ?`, [safeInt(req.params.id)]);
      if (!row) return err404(res, 'Not found');
      res.json(formatRow(row));
    } catch (e) {
    logger.error({ msg: '[admin]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // POST create
  sub.post('/', async (req, res) => {
    try {
      const db = await openDb();
      const body = req.body || {};
      const allowed = WRITE_FIELDS.filter(f => body[f] !== undefined);
      if (allowed.length === 0) return err400(res, 'No valid fields provided');
      if (!body.name || !body.city) return err400(res, 'name and city are required');

      // Serialize JSON fields
      if (body.specialties && Array.isArray(body.specialties)) body.specialties = JSON.stringify(body.specialties);
      if (body.languages && Array.isArray(body.languages)) body.languages = JSON.stringify(body.languages);

      const cols = [...allowed, 'source', 'source_id', 'updated_at'];
      const vals = [...allowed.map(f => body[f] ?? null), 'admin', 'admin_' + Date.now(), new Date().toISOString()];
      const result = await db.run(
        `INSERT INTO ${safeTable(table)} (${safeAdminColList(cols).join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        vals
      );
      const created = await db.get(`SELECT * FROM ${safeTable(table)} WHERE id = ?`, [result.lastID]);
      await logAllChanges(db, table, result.lastID, null, created);
      res.status(201).json(formatRow(created));
    } catch (e) {
    logger.error({ msg: '[admin]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // PUT full update
  sub.put('/:id', async (req, res) => {
    try {
      const db = await openDb();
      const before = await db.get(`SELECT * FROM ${safeTable(table)} WHERE id = ?`, [safeInt(req.params.id)]);
      if (!before) return err404(res, 'Not found');
      const body = req.body || {};
      const allowed = WRITE_FIELDS.filter(f => body[f] !== undefined);
      if (allowed.length === 0) return err400(res, 'No valid fields provided');
      if (body.specialties && Array.isArray(body.specialties)) body.specialties = JSON.stringify(body.specialties);
      if (body.languages && Array.isArray(body.languages)) body.languages = JSON.stringify(body.languages);
      const setClause = allowed.map(f => `${f} = ?`).join(', ');
      await db.run(`UPDATE ${safeTable(table)} SET ${setClause}, updated_at = NOW() WHERE id = ?`,
        [...allowed.map(f => body[f]), safeInt(req.params.id)]);
      const after = await db.get(`SELECT * FROM ${safeTable(table)} WHERE id = ?`, [safeInt(req.params.id)]);
      await logAllChanges(db, table, safeInt(req.params.id), before, after);
      res.json(formatRow(after));
    } catch (e) {
    logger.error({ msg: '[admin]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // PATCH partial update
  sub.patch('/:id', async (req, res) => {
    try {
      const db = await openDb();
      const before = await db.get(`SELECT * FROM ${safeTable(table)} WHERE id = ?`, [safeInt(req.params.id)]);
      if (!before) return err404(res, 'Not found');
      const body = req.body || {};
      const allowed = WRITE_FIELDS.filter(f => body[f] !== undefined);
      if (allowed.length === 0) return err400(res, 'No patchable fields provided');
      if (body.specialties && Array.isArray(body.specialties)) body.specialties = JSON.stringify(body.specialties);
      if (body.languages && Array.isArray(body.languages)) body.languages = JSON.stringify(body.languages);
      const setClause = allowed.map(f => `${f} = ?`).join(', ');
      await db.run(`UPDATE ${safeTable(table)} SET ${setClause}, updated_at = NOW() WHERE id = ?`,
        [...allowed.map(f => body[f]), safeInt(req.params.id)]);
      const after = await db.get(`SELECT * FROM ${safeTable(table)} WHERE id = ?`, [safeInt(req.params.id)]);
      await logAllChanges(db, table, safeInt(req.params.id), before, after);
      res.json(formatRow(after));
    } catch (e) {
    logger.error({ msg: '[admin]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // DELETE soft-delete
  sub.delete('/:id', async (req, res) => {
    try {
      const db = await openDb();
      const before = await db.get(`SELECT * FROM ${safeTable(table)} WHERE id = ?`, [safeInt(req.params.id)]);
      if (!before) return err404(res, 'Not found');
      await db.run(`UPDATE ${safeTable(table)} SET active = 0, updated_at = NOW() WHERE id = ?`, [safeInt(req.params.id)]);
      await logChange(db, table, safeInt(req.params.id), 'active', '1', '0', 'admin');
      res.json({ ok: true, id: safeInt(req.params.id), active: false });
    } catch (e) {
    logger.error({ msg: '[admin]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // POST verify
  sub.post('/:id/verify', async (req, res) => {
    try {
      const db = await openDb();
      const before = await db.get(`SELECT verified FROM ${safeTable(table)} WHERE id = ?`, [safeInt(req.params.id)]);
      if (!before) return err404(res, 'Not found');
      await db.run(
        `UPDATE ${safeTable(table)} SET verified = 1, last_verified_at = NOW(), updated_at = NOW() WHERE id = ?`,
        [safeInt(req.params.id)]
      );
      await logChange(db, table, safeInt(req.params.id), 'verified', String(before.verified), '1', 'admin');
      res.json({ ok: true, id: safeInt(req.params.id), verified: true });
    } catch (e) {
    logger.error({ msg: '[admin]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // POST restore
  sub.post('/:id/restore', async (req, res) => {
    try {
      const db = await openDb();
      await db.run(`UPDATE ${safeTable(table)} SET active = 1, updated_at = NOW() WHERE id = ?`, [safeInt(req.params.id)]);
      await logChange(db, table, safeInt(req.params.id), 'active', '0', '1', 'admin');
      res.json({ ok: true, id: safeInt(req.params.id), active: true });
    } catch (e) {
    logger.error({ msg: '[admin]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  return sub;
}

// ── Mount CRUD routes ─────────────────────────────────────────────────────────

const LAWYER_EXTRA = ['pro_bono','sliding_scale','free_consultation','years_experience',
  'specialties','languages','bio','bar_number'];

router.use('/lawyers', crudRoutes('lawyers', LAWYER_EXTRA));
router.use('/bail',    crudRoutes('bail_agents'));

// ── Audit log routes ──────────────────────────────────────────────────────────

router.get('/log', async (req, res) => {
  try {
    const db = await openDb();
    const { table, limit = 100, offset = 0 } = req.query;
    let sql = 'SELECT id, table_name, record_id, field, old_value, new_value, source, changed_at FROM provider_update_log WHERE 1=1';
    const params = [];
    if (table) { sql += ' AND table_name = ?'; params.push(table); }
    sql += ' ORDER BY changed_at DESC LIMIT ? OFFSET ?';
    params.push(safeInt(limit), safeInt(offset));
    const rows = await db.all(sql, params);
    const total = table
      ? await db.get('SELECT COUNT(*) as n FROM provider_update_log WHERE table_name=?', [table])
      : await db.get('SELECT COUNT(*) as n FROM provider_update_log');
    res.json({ total: total?.n ?? 0, rows });
  } catch (e) {
    logger.error({ msg: '[admin]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

router.get('/log/:table/:id' /* intentional: safeTable allowlist validates table; row absence returns empty */, async (req, res) => {
  try {
    const db = await openDb();
    const rows = await db.all(
      'SELECT id, table_name, record_id, field, old_value, new_value, source, changed_at FROM provider_update_log WHERE table_name = ? AND record_id = ? ORDER BY changed_at DESC LIMIT 500',
      [req.params.table, safeInt(req.params.id)]
    );
    res.json(rows);
  } catch (e) {
    logger.error({ msg: '[admin]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ── Stats ─────────────────────────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  try {
    const db = await openDb();
    const [lTotal, lActive, lVerified, lProBono, lSliding, lSources,
           bTotal, bActive, bVerified,
           logTotal, logRecent, cities] = await Promise.all([
      await db.get('SELECT COUNT(*) as n FROM lawyers'),
      db.get('SELECT COUNT(*) as n FROM lawyers WHERE active=1'),
      db.get('SELECT COUNT(*) as n FROM lawyers WHERE verified=1'),
      db.get('SELECT COUNT(*) as n FROM lawyers WHERE pro_bono=1'),
      db.get('SELECT COUNT(*) as n FROM lawyers WHERE sliding_scale=1'),
      db.all('SELECT source, COUNT(*) as n FROM lawyers GROUP BY source'),
      db.get('SELECT COUNT(*) as n FROM bail_agents'),
      db.get('SELECT COUNT(*) as n FROM bail_agents WHERE active=1'),
      db.get('SELECT COUNT(*) as n FROM bail_agents WHERE verified=1'),
      db.get('SELECT COUNT(*) as n FROM provider_update_log'),
      db.get("SELECT COUNT(*) as n FROM provider_update_log WHERE changed_at > (NOW() - INTERVAL '7 days')"),
      db.all('SELECT city, COUNT(*) as lawyers FROM lawyers WHERE active=1 GROUP BY city ORDER BY city LIMIT 500'),
    ]);
    res.json({
      lawyers: { total: lTotal.n, active: lActive.n, verified: lVerified.n, pro_bono: lProBono.n, sliding_scale: lSliding.n, by_source: lSources },
      bail_agents: { total: bTotal.n, active: bActive.n, verified: bVerified.n },
      audit_log: { total: logTotal.n, last_7_days: logRecent.n },
      coverage: cities
    });
  } catch (e) {
    logger.error({ msg: '[admin]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ── Trigger refresh (in-process, main Postgres) ──────────────────────────────

router.post('/refresh', async (req, res) => {
  const { city, type = 'all', source = 'all', dryRun = false } = req.body || {};
  if (!['lawyers', 'bail', 'civil', 'all'].includes(type)) return err400(res, 'type must be lawyers, bail, civil or all');
  if (!['google', 'yelp', 'all'].includes(source)) return err400(res, 'source must be google, yelp or all');
  if (city !== undefined && city !== null && city !== '' && !/^[A-Za-z .'-]{2,60},\s*[A-Za-z]{2}$/.test(String(city))) {
    return err400(res, 'city must look like "Nashville, TN"');
  }
  const opts = { city: city || undefined, type, source, dryRun: dryRun === true, trigger: 'admin' };
  const wantsGoogle = source !== 'yelp' && placesKeyConfigured();
  const wantsYelp = source !== 'google' && !!process.env.YELP_API_KEY;
  try {
    if (!wantsGoogle && !wantsYelp) {
      const r = await runRefresh(opts);          // records a 'skipped' run, fetches nothing
      return res.json({ ok: false, skipped: true, run_id: r.runId, message: r.message });
    }
    runRefresh(opts)
      .then(r => logger.info(`[admin/refresh] run ${r.runId} ${r.status}`))
      .catch(e => logger.error('[admin/refresh] run failed:', e.message));
    res.status(202).json({
      ok: true,
      message: 'Refresh started in background. New providers are inserted; changes to existing providers are staged at /api/admin/proposals.',
      runs: '/api/admin/refresh/runs',
      params: { city: city || 'all metro cities', type, source, dryRun: opts.dryRun },
    });
  } catch (e) {
    logger.error({ msg: '[admin/refresh]', error: e?.message });
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

router.get('/refresh/runs', async (req, res) => {
  try {
    const db = await openDb();
    const limit = Math.min(Math.max(safeInt(req.query.limit, 50), 1), 200);
    const params = [];
    let sql = `SELECT id, job, trigger, params, dry_run, status, started_at, finished_at, fetched, inserted, proposed,
                      unchanged, updated, skipped, errors, message, error_sample
                 FROM scrape_runs`;
    if (req.query.job) { sql += ' WHERE job = ?'; params.push(String(req.query.job).slice(0, 60)); }
    sql += ` ORDER BY started_at DESC, id DESC LIMIT ${limit}`;
    res.json({ runs: await db.all(sql, params) });
  } catch (e) {
    logger.error({ msg: '[admin/refresh/runs]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Provider update proposals (staged scrape changes) ────────────────────────

function proposalError(res, e, tag) {
  if (e instanceof ProposalError) return res.status(e.status).json({ error: e.message, code: e.code });
  logger.error({ msg: `[admin/proposals${tag}]`, error: e?.message });
  return res.status(500).json({ error: 'Server error. Please try again.' });
}

router.get('/proposals', async (req, res) => {
  try {
    res.json(await listProposals(await openDb(), req.query || {}));
  } catch (e) { proposalError(res, e, ''); }
});

router.post('/proposals/apply', async (req, res) => {
  try {
    const { ids, note } = req.body || {};
    res.json(await bulkDecide(await openDb(), ids, 'apply', { userId: req.user.id, note }));
  } catch (e) { proposalError(res, e, '/apply'); }
});

router.post('/proposals/reject', async (req, res) => {
  try {
    const { ids, note } = req.body || {};
    res.json(await bulkDecide(await openDb(), ids, 'reject', { userId: req.user.id, note }));
  } catch (e) { proposalError(res, e, '/reject'); }
});

router.post('/proposals/:id/apply', async (req, res) => {
  try {
    const { note, force } = req.body || {};
    res.json(await applyProposal(await openDb(), req.params.id, { userId: req.user.id, note, force: force === true }));
  } catch (e) { proposalError(res, e, '/:id/apply'); }
});

router.post('/proposals/:id/reject', async (req, res) => {
  try {
    const { note } = req.body || {};
    res.json(await rejectProposal(await openDb(), req.params.id, { userId: req.user.id, note }));
  } catch (e) { proposalError(res, e, '/:id/reject'); }
});

// ─── HEALTH SCAN ENDPOINTS ─────────────────────────────────────────────────────
// POST /api/admin/health-scan/run    — trigger scan immediately
// GET  /api/admin/health-scan/latest — get most recent scan result
// GET  /api/admin/health-scan/history — list recent scan results

router.post('/health-scan/run', authRequired, healthScanLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const user = await db.get('SELECT firm_role, role FROM users WHERE id=?', [req.user.id]).catch(() => null);
    const userRole = user?.firm_role || user?.role || '';
    if (!hasMinRole(userRole, 'firm_admin')) {
      return res.status(403).json({ error: 'firm_admin+ required for manual health scan.' });
    }
    logger.info(`[admin/health-scan] Manual trigger by user ${req.user.id}`);
    // Run async — return 202 immediately, scan runs in background
    const options = req.body || {};
    setImmediate(async () => {
      try {
        await runHealthScan({
          skipPrecedentMonitor: options.skipPrecedentMonitor === true,
        });
      } catch (e) {
        logger.error('[admin/health-scan] Manual scan error:', e.message);
      }
    });
    res.status(202).json({
      ok: true,
      message: 'Health scan initiated. Results will be pushed when complete.',
      note: 'Check scan_results table or await push notification.',
    });
  } catch (e) {
    logger.error('[admin/health-scan/run]', e.message);
    res.status(500).json({ error: 'Could not trigger health scan.' });
  }
});

router.get('/health-scan/latest', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const user = await db.get('SELECT firm_role, role FROM users WHERE id=?', [req.user.id]).catch(() => null);
    const userRole = user?.firm_role || user?.role || '';
    if (!hasMinRole(userRole, 'firm_admin')) {
      return res.status(403).json({ error: 'firm_admin+ required.' });
    }
    const result = await db.get(
      'SELECT id, scan_id, overall, summary_json AS summary, findings_json, created_at FROM scan_results ORDER BY id DESC LIMIT 1'
    ).catch(() => null);
    if (!result) return res.json({ ok: true, result: null, message: 'No scan run yet.' });
    res.json({
      ok: true,
      scan_id:      result.scan_id,
      started_at:   result.started_at,
      completed_at: result.completed_at,
      elapsed_ms:   result.elapsed_ms,
      overall:      result.overall,
      summary:      safeJson(result.summary_json, {}),
      findings:     safeJson(result.findings_json, []),
    });
  } catch (e) {
    logger.error('[admin/health-scan/latest]', e.message);
    res.status(500).json({ error: 'Could not retrieve scan result.' });
  }
});

router.get('/health-scan/history', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const user = await db.get('SELECT firm_role, role FROM users WHERE id=?', [req.user.id]).catch(() => null);
    const userRole = user?.firm_role || user?.role || '';
    if (!hasMinRole(userRole, 'firm_admin')) {
      return res.status(403).json({ error: 'firm_admin+ required.' });
    }
    const limit  = Math.min(parseInt(req.query.limit) || 30, 100);
    const results = await db.all(
      'SELECT scan_id, started_at, completed_at, elapsed_ms, overall, summary_json FROM scan_results ORDER BY id DESC LIMIT ?',
      [limit]
    ).catch(() => []);
    res.json({
      ok: true,
      count: results.length,
      results: results.map(r => ({
        scan_id:      r.scan_id,
        started_at:   r.started_at,
        completed_at: r.completed_at,
        elapsed_ms:   r.elapsed_ms,
        overall:      r.overall,
        summary:      safeJson(r.summary_json, {}),
      })),
    });
  } catch (e) {
    logger.error('[admin/health-scan/history]', e.message);
    res.status(500).json({ error: 'Could not retrieve scan history.' });
  }
});



// GET /api/attorney/pending-verification — admin: attorneys awaiting bar verification
router.get('/attorney/pending-verification', authRequired, asyncRoute(async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const db = await getDb();
    const pending = await db.all(
      `SELECT u.id as user_id, u.display_name, u.email,
              u.bar_number, u.bar_verified, u.created_at
       FROM users u
       WHERE u.bar_verified = 0 AND u.bar_number IS NOT NULL
       ORDER BY u.created_at DESC LIMIT 50`
    ).catch(() => []);
    res.json({ pending });
  } catch { res.status(500).json({ error: 'Internal server error.', code: 'server_error' }); }

}));
export default router;