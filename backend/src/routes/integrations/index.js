/**
 * routes/integrations/index.js — Integration Connection Management Hub
 *
 * Central API for all third-party integration connections.
 * Individual provider logic lives in ./dms.js, ./practice-mgmt.js,
 * ./caldav.js, and ../webhooks/outbound.js
 *
 * Connection lifecycle:
 *   POST   /api/integrations/connect                  — initiate OAuth or API-key connection
 *   GET    /api/integrations                          — list firm connections
 *   GET    /api/integrations/:provider                — get single connection status
 *   DELETE /api/integrations/:provider                — revoke connection
 *   POST   /api/integrations/:provider/sync           — trigger manual sync
 *   GET    /api/integrations/:provider/sync/log       — sync history
 *   POST   /api/integrations/oauth/callback           — OAuth2 callback handler
 */

import { Router }          from 'express';
import { getDb }           from '../../db/index.js';
import { authRequired }    from '../../middleware/auth.js';
import { requireFirmRole, loadFirmContext } from '../../middleware/rbac.js';
import { writeAuditLog }   from '../../middleware/audit.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';
import { err400, err403, err404, safeInt,
         sanitizeStr, truncateStr }         from '../../utils/routeHelpers.js';
import logger              from '../../utils/logger.js';
import { CONFIG }           from '../../config.js';
import { createHmac, randomBytes }          from 'crypto';

const router     = Router();
const connLimiter = makeUserLimiter({ windowMs: 3_600_000, max: 60, message: 'Integration limit reached.' });

// Provider catalogue — what each provider supports
export const PROVIDERS = {
  imanage: {
    label:     'iManage Work',
    category:  'dms',
    auth_type: 'oauth2',
    features:  ['document_sync','matter_sync','search'],
    oauth_url: 'https://cloudimanage.com/work/api/v2/oauth2/authorize',
    token_url: 'https://cloudimanage.com/work/api/v2/oauth2/token',
    scope:     'user documents.read documents.write workspaces matters',
    docs_url:  'https://docs.imanage.com/api',
  },
  netdocuments: {
    label:     'NetDocuments',
    category:  'dms',
    auth_type: 'oauth2',
    features:  ['document_sync','cabinet_sync','search'],
    oauth_url: 'https://vault.netvoyage.com/neWeb2/OAuth.aspx',
    token_url: 'https://api.vault.netvoyage.com/v1/oauth/token',
    scope:     'read write',
    docs_url:  'https://support.netdocuments.com/api',
  },
  clio: {
    label:     'Clio Manage',
    category:  'practice_mgmt',
    auth_type: 'oauth2',
    features:  ['matter_sync','contact_sync','time_entry_sync','invoice_sync'],
    oauth_url: 'https://app.clio.com/oauth/authorize',
    token_url: 'https://app.clio.com/oauth/token',
    scope:     'openid',
    docs_url:  'https://app.clio.com/api/v4/documentation',
  },
  practicepanther: {
    label:     'PracticePanther',
    category:  'practice_mgmt',
    auth_type: 'oauth2',
    features:  ['matter_sync','contact_sync','time_entry_sync','invoice_sync'],
    oauth_url: 'https://api.practicepanther.com/oauth/authorize',
    token_url: 'https://api.practicepanther.com/oauth/token',
    scope:     'read write',
    docs_url:  'https://www.practicepanther.com/api',
  },
  mycase: {
    label:     'MyCase',
    category:  'practice_mgmt',
    auth_type: 'oauth2',
    features:  ['matter_sync','contact_sync','invoice_sync'],
    oauth_url: 'https://app.mycase.com/oauth/authorize',
    token_url: 'https://app.mycase.com/oauth/token',
    scope:     'read write',
    docs_url:  'https://app.mycase.com/api/v1',
  },
  caldav: {
    label:     'CalDAV (Generic)',
    category:  'calendar',
    auth_type: 'basic_or_token',
    features:  ['event_push','event_pull','deadline_sync'],
    docs_url:  'https://tools.ietf.org/html/rfc4791',
  },
  google_calendar: {
    label:     'Google Calendar',
    category:  'calendar',
    auth_type: 'oauth2',
    features:  ['event_push','event_pull','deadline_sync'],
    oauth_url: 'https://accounts.google.com/o/oauth2/v2/auth',
    token_url: 'https://oauth2.googleapis.com/token',
    scope:     'https://www.googleapis.com/auth/calendar.events',
    docs_url:  'https://developers.google.com/calendar',
  },
  outlook: {
    label:     'Microsoft Outlook / Exchange',
    category:  'calendar',
    auth_type: 'oauth2',
    features:  ['event_push','event_pull','deadline_sync'],
    oauth_url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token_url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope:     'Calendars.ReadWrite offline_access',
    docs_url:  'https://docs.microsoft.com/en-us/graph/api/resources/event',
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Mask sensitive token for display */
function maskToken(token) {
  if (!token) return null;
  return token.slice(0, 8) + '…' + token.slice(-4);
}

/** Generate a webhook signing secret */
function generateSecret() {
  return randomBytes(32).toString('hex');
}

/** Check if OAuth token needs refresh (within 5 min of expiry) */
function tokenNeedsRefresh(expiresAt) {
  if (!expiresAt) return true;
  return new Date(expiresAt) < new Date(Date.now() + 5 * 60 * 1000);
}

/** Build OAuth initiation URL */
function buildOAuthUrl(provider, firmId, userId, baseUrl) {
  const p = PROVIDERS[provider];
  if (!p?.oauth_url) return null;

  const providerKey = provider === 'google_calendar' ? 'google_calendar'
    : provider === 'practicepanther' ? 'practicepanther' : provider;
  const clientId = CONFIG.integrations[providerKey]?.clientId || 'demo_client_id';
  const redirectUri  = `${baseUrl}/api/integrations/oauth/callback`;
  const state        = Buffer.from(JSON.stringify({ provider, firm_id: firmId, user_id: userId })).toString('base64url');

  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'code',
    redirect_uri:  redirectUri,
    scope:         p.scope || '',
    state,
  });

  return `${p.oauth_url}?${params.toString()}`;
}

/**
 * refreshTokenIfNeeded(db, conn)
 * Refreshes an OAuth2 access token before it expires, then updates the DB.
 * Called at the top of every sync operation — silent on demo mode or API-key providers.
 * Returns a fresh conn object with updated tokens; callers use the returned value.
 */
export async function refreshTokenIfNeeded(db, conn) {
  if (!conn?.access_token || conn.access_token.startsWith('demo_')) return conn;
  if (!conn.refresh_token) return conn;
  if (!tokenNeedsRefresh(conn.token_expires_at)) return conn;

  const p = PROVIDERS[conn.provider];
  if (!p?.token_url) return conn;

  const provKey      = conn.provider === 'google_calendar' ? 'google_calendar' : conn.provider;
  const clientId     = CONFIG.integrations[provKey]?.clientId     || '';
  const clientSecret = CONFIG.integrations[provKey]?.clientSecret || '';
  if (!clientId || !clientSecret) return conn;

  try {
    const resp = await fetch(p.token_url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: conn.refresh_token,
        client_id:     clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      logger.warn(`[integrations/refresh] ${conn.provider} token refresh ${resp.status}: ${errText.slice(0,100)}`);
      await db.run(
        "UPDATE integration_connections SET status='token_expired', last_error=?, updated_at=datetime('now') WHERE id=?",
        [`Re-authorization required — token refresh failed (${resp.status})`, conn.id]
      ).catch(() => {});
      return conn;
    }

    const td         = await resp.json();
    const newAccess  = td.access_token;
    const newRefresh = td.refresh_token || conn.refresh_token;
    const newExpiry  = td.expires_in
      ? new Date(Date.now() + td.expires_in * 1000).toISOString()
      : null;

    await db.run(
      `UPDATE integration_connections
       SET access_token=?, refresh_token=?, token_expires_at=?,
           status='active', last_error=NULL, updated_at=datetime('now')
       WHERE id=?`,
      [newAccess, newRefresh, newExpiry, conn.id]
    );

    logger.info(`[integrations/refresh] ${conn.provider} token refreshed (firm ${conn.firm_id})`);
    return { ...conn, access_token: newAccess, refresh_token: newRefresh, token_expires_at: newExpiry };
  } catch (e) {
    logger.warn(`[integrations/refresh] ${conn.provider} refresh error: ${e.message}`);
    return conn;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CATALOGUE
// ══════════════════════════════════════════════════════════════════════════════

router.get('/catalogue', authRequired, (req, res) => {
  res.json({
    providers: Object.entries(PROVIDERS).map(([key, p]) => ({
      key,
      label:     p.label,
      category:  p.category,
      auth_type: p.auth_type,
      features:  p.features,
      docs_url:  p.docs_url,
    })),
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// LIST / GET CONNECTIONS
// ══════════════════════════════════════════════════════════════════════════════

router.get('/', authRequired, requireFirmRole('partner'), async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = req.firmCtx;

    const conns = await db.all(
      `SELECT id, provider, status, instance_url, customer_id, scope,
              last_sync_at, last_error, created_at, updated_at
       FROM integration_connections WHERE firm_id=? ORDER BY provider ASC`,
      [ctx.firm_id]
    );

    const enriched = conns.map(c => ({
      ...c,
      provider_label:    PROVIDERS[c.provider]?.label || c.provider,
      provider_category: PROVIDERS[c.provider]?.category,
      features:          PROVIDERS[c.provider]?.features || [],
    }));

    res.json({ connections: enriched, count: enriched.length });
  } catch (e) {
    logger.error('[integrations/list]', e.message);
    res.status(500).json({ error: 'Could not load integrations.' });
  }
});

router.get('/:provider', authRequired, requireFirmRole('partner'), async (req, res) => {
  try {
    const db       = await getDb();
    const ctx      = req.firmCtx;
    const provider = sanitizeStr(req.params.provider, 50);

    if (!PROVIDERS[provider]) return err400(res, `Unknown provider "${provider}". GET /api/integrations/catalogue for options.`);

    const conn = await db.get(
      `SELECT id, provider, status, instance_url, customer_id, scope,
              last_sync_at, last_error, token_expires_at, created_at, updated_at
       FROM integration_connections WHERE firm_id=? AND provider=?`,
      [ctx.firm_id, provider]
    );

    if (!conn) {
      return res.json({
        connected:   false,
        provider,
        provider_label: PROVIDERS[provider].label,
        features:    PROVIDERS[provider].features,
      });
    }

    // Sync log summary
    const recentSync = await db.all(
      `SELECT status, entity_type, records_sent, records_received, error_msg, created_at
       FROM integration_sync_log WHERE connection_id=? ORDER BY created_at DESC LIMIT 5`,
      [conn.id]
    ).catch(() => []);

    res.json({
      connected:   conn.status === 'active',
      ...conn,
      token_masked: maskToken(null), // never expose tokens
      token_expiry_status: tokenNeedsRefresh(conn.token_expires_at) ? 'needs_refresh' : 'valid',
      provider_label:    PROVIDERS[provider].label,
      provider_category: PROVIDERS[provider].category,
      features:          PROVIDERS[provider].features,
      recent_syncs:      recentSync,
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load integration.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// CONNECT — initiate OAuth or API key connection
// ══════════════════════════════════════════════════════════════════════════════

router.post('/connect', authRequired, requireFirmRole('firm_admin'), connLimiter, async (req, res) => {
  try {
    const db       = await getDb();
    const ctx      = req.firmCtx;

    const {
      provider,
      // OAuth2: handled via redirect (returns oauth_url)
      // API key providers: these fields
      access_token,
      instance_url,
      customer_id,
      // CalDAV basic auth
      username,
      password,
      calendar_url,
    } = req.body || {};

    if (!provider || !PROVIDERS[provider]) {
      return err400(res, `provider required. Options: ${Object.keys(PROVIDERS).join(', ')}`);
    }

    const p = PROVIDERS[provider];

    // OAuth2 providers — return authorization URL (client redirects user)
    if (p.auth_type === 'oauth2' && !access_token) {
      const baseUrl  = process.env.BASE_URL || process.env.CORS_ORIGIN || 'https://justicegavel.app';
      const oauthUrl = buildOAuthUrl(provider, ctx.firm_id, req.user.id, baseUrl);

      if (!oauthUrl) return err400(res, `No OAuth URL configured for ${provider}.`);

      // Create pending connection record
      const existing = await db.get('SELECT id FROM integration_connections WHERE firm_id=? AND provider=?', [ctx.firm_id, provider]);
      if (!existing) {
        await db.run(
          `INSERT INTO integration_connections (firm_id, user_id, provider, status) VALUES (?,?,?,?)`,
          [ctx.firm_id, req.user.id, provider, 'pending']
        );
      } else {
        await db.run("UPDATE integration_connections SET status='pending', updated_at=datetime('now') WHERE firm_id=? AND provider=?", [ctx.firm_id, provider]);
      }

      return res.json({
        oauth_redirect_required: true,
        oauth_url: oauthUrl,
        provider,
        provider_label: p.label,
        message: `Redirect the user to oauth_url to authorize ${p.label}. After authorization, the user will be returned to your redirect_uri with a code parameter.`,
      });
    }

    // API-key / direct-credential providers (CalDAV basic auth, etc.)
    if (!access_token && !(username && password)) {
      return err400(res, 'access_token or username+password required for direct connection.');
    }

    // Build metadata
    const metadata = {};
    if (calendar_url) metadata.calendar_url = calendar_url;
    if (username)     metadata.username      = username;

    // For CalDAV basic-auth: token = base64(username:password)
    const effectiveToken = access_token || (username && password
      ? Buffer.from(`${username}:${password}`).toString('base64')
      : null);

    const existing = await db.get('SELECT id FROM integration_connections WHERE firm_id=? AND provider=?', [ctx.firm_id, provider]);
    if (existing) {
      await db.run(
        `UPDATE integration_connections SET
           status='active', access_token=?, instance_url=?, customer_id=?,
           metadata=?, updated_at=datetime('now')
         WHERE id=?`,
        [effectiveToken, instance_url || null, customer_id || null,
         JSON.stringify(metadata), existing.id]
      );
    } else {
      await db.run(
        `INSERT INTO integration_connections
           (firm_id, user_id, provider, status, access_token, instance_url, customer_id, metadata)
         VALUES (?,?,?,?,?,?,?,?)`,
        [ctx.firm_id, req.user.id, provider, 'active', effectiveToken,
         instance_url || null, customer_id || null, JSON.stringify(metadata)]
      );
    }

    await writeAuditLog(db, {
      user_id: req.user.id, firm_id: ctx.firm_id,
      action: 'integration_connect', resource: 'integration',
      detail: JSON.stringify({ provider }),
      ip: req.ip, ua: req.headers['user-agent'],
    });

    res.json({
      connected:      true,
      provider,
      provider_label: p.label,
      status:         'active',
    });
  } catch (e) {
    logger.error('[integrations/connect]', e.message);
    res.status(500).json({ error: 'Could not connect integration.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// OAUTH CALLBACK — exchange code for tokens
// ══════════════════════════════════════════════════════════════════════════════

router.get('/oauth/callback', async (req, res) => {
  try {
    const db = await getDb();
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      logger.warn('[integrations/oauth] Provider error:', oauthError);
      const redirectBase = process.env.APP_OAUTH_REDIRECT || process.env.CORS_ORIGIN || 'https://justicegavel.app';
      return res.redirect(`${redirectBase}/settings/integrations?error=${encodeURIComponent(oauthError)}`);
    }

    if (!code || !state) return err400(res, 'Missing code or state parameter.');

    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
    } catch (e) {
      logger.warn('[integrations/oauth] invalid state:', e?.message);
      return err400(res, 'Invalid state parameter.');
    }

    const { provider, firm_id, user_id } = stateData;
    const p = PROVIDERS[provider];
    if (!p) return err400(res, 'Unknown provider in state.');

    // Exchange code for tokens
    const provKey  = provider === 'google_calendar' ? 'google_calendar' : provider === 'practicepanther' ? 'practicepanther' : provider;
    const clientId = CONFIG.integrations[provKey]?.clientId || '';
    const clientSecret = CONFIG.integrations[provKey]?.clientSecret || '';
    const redirectUri  = `${process.env.BASE_URL || process.env.CORS_ORIGIN || 'https://justicegavel.app'}/api/integrations/oauth/callback`;

    let accessToken = null, refreshToken = null, expiresAt = null;

    if (clientId && clientSecret && p.token_url) {
      try {
        const tokenResp = await fetch(p.token_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
          body: new URLSearchParams({
            grant_type:    'authorization_code',
            code,
            redirect_uri:  redirectUri,
            client_id:     clientId,
            client_secret: clientSecret,
          }).toString(),
        });

        if (tokenResp.ok) {
          const tokenData  = await tokenResp.json();
          accessToken  = tokenData.access_token;
          refreshToken = tokenData.refresh_token || null;
          expiresAt    = tokenData.expires_in
            ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
            : null;
        }
      } catch (e) {
        logger.warn('[integrations/oauth] Token exchange failed:', e.message);
        // Fall through — save pending state with code for manual exchange
      }
    } else {
      // Demo mode — no credentials configured, store a demo token
      accessToken  = `demo_${provider}_${randomBytes(8).toString('hex')}`;
      expiresAt    = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    }

    // Upsert connection
    const existing = await db.get('SELECT id FROM integration_connections WHERE firm_id=? AND provider=?', [firm_id, provider]);
    const newStatus = accessToken ? 'active' : 'error';

    if (existing) {
      await db.run(
        `UPDATE integration_connections SET
           status=?, access_token=?, refresh_token=?, token_expires_at=?,
           updated_at=datetime('now')
         WHERE id=?`,
        [newStatus, accessToken, refreshToken, expiresAt, existing.id]
      );
    } else {
      await db.run(
        `INSERT INTO integration_connections
           (firm_id, user_id, provider, status, access_token, refresh_token, token_expires_at)
         VALUES (?,?,?,?,?,?,?)`,
        [firm_id, user_id, provider, newStatus, accessToken, refreshToken, expiresAt]
      );
    }

    await writeAuditLog(db, {
      user_id, firm_id,
      action: 'integration_oauth_complete', resource: 'integration',
      detail: JSON.stringify({ provider, status: newStatus }),
    });

    const redirectBase = process.env.APP_OAUTH_REDIRECT || process.env.CORS_ORIGIN || 'https://justicegavel.app';
    res.redirect(`${redirectBase}/settings/integrations?provider=${provider}&status=${newStatus}`);
  } catch (e) {
    logger.error('[integrations/oauth/callback]', e.message);
    res.status(500).json({ error: 'OAuth callback failed.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// REVOKE / DELETE CONNECTION
// ══════════════════════════════════════════════════════════════════════════════

router.delete('/:provider', authRequired, requireFirmRole('firm_admin'), async (req, res) => {
  try {
    const db       = await getDb();
    const ctx      = req.firmCtx;
    const provider = sanitizeStr(req.params.provider, 50);

    const conn = await db.get('SELECT id FROM integration_connections WHERE firm_id=? AND provider=?', [ctx.firm_id, provider]);
    if (!conn) return err404(res, `No ${provider} connection found.`);

    await db.run("UPDATE integration_connections SET status='revoked', access_token=NULL, refresh_token=NULL, updated_at=datetime('now') WHERE id=?", [conn.id]);

    await writeAuditLog(db, {
      user_id: req.user.id, firm_id: ctx.firm_id,
      action: 'integration_revoke', resource: 'integration',
      detail: JSON.stringify({ provider }), ip: req.ip,
    });

    res.json({ ok: true, provider, status: 'revoked' });
  } catch (e) {
    res.status(500).json({ error: 'Could not revoke integration.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// SYNC — trigger a manual sync operation
// ══════════════════════════════════════════════════════════════════════════════

router.post('/:provider/sync', authRequired, requireFirmRole('partner'), connLimiter, async (req, res) => {
  try {
    const db       = await getDb();
    const ctx      = req.firmCtx;
    const provider = sanitizeStr(req.params.provider, 50);

    const conn = await db.get(
      "SELECT * /* intentional: integration provider schema varies */ /* integration schema varies — projection Phase 2 */ FROM integration_connections WHERE firm_id=? AND provider=? AND status='active'",
      [ctx.firm_id, provider]
    );
    if (!conn) return err404(res, `No active ${provider} connection. Connect first via POST /api/integrations/connect.`);

    const { entity_type = 'matter', direction = 'push', matter_id } = req.body || {};
    const VALID_ENTITIES = ['matter','document','contact','invoice','time_entry','event'];
    const VALID_DIRS     = ['push','pull','bidirectional'];

    if (!VALID_ENTITIES.includes(entity_type)) return err400(res, `entity_type must be one of: ${VALID_ENTITIES.join(', ')}`);
    if (!VALID_DIRS.includes(direction))       return err400(res, `direction must be one of: ${VALID_DIRS.join(', ')}`);

    // Dispatch to the correct provider sync handler
    let result;
    const category = PROVIDERS[provider]?.category;

    if (category === 'dms') {
      const { syncDMS }  = await import('./dms.js');
      result = await syncDMS({ db, conn, ctx, entity_type, direction, matter_id: matter_id ? safeInt(matter_id) : null, user: req.user });
    } else if (category === 'practice_mgmt') {
      const { syncPracticeMgmt } = await import('./practice-mgmt.js');
      result = await syncPracticeMgmt({ db, conn, ctx, entity_type, direction, matter_id: matter_id ? safeInt(matter_id) : null, user: req.user });
    } else if (category === 'calendar') {
      const { syncCalendar } = await import('./caldav.js');
      result = await syncCalendar({ db, conn, ctx, entity_type, direction, matter_id: matter_id ? safeInt(matter_id) : null, user: req.user });
    } else {
      result = { status: 'error', error: `No sync handler for provider category: ${category}` };
    }

    // Write sync log
    await db.run(
      `INSERT INTO integration_sync_log
         (connection_id, firm_id, direction, entity_type, entity_id, external_id,
          status, error_msg, records_sent, records_received)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [conn.id, ctx.firm_id, direction, entity_type,
       matter_id ? safeInt(matter_id) : null, result.external_id || null,
       result.status, result.error || null,
       result.records_sent || 0, result.records_received || 0]
    );

    if (result.status === 'success') {
      await db.run("UPDATE integration_connections SET last_sync_at=datetime('now'), last_error=NULL WHERE id=?", [conn.id]);
    } else if (result.status === 'error') {
      await db.run("UPDATE integration_connections SET last_error=?, updated_at=datetime('now') WHERE id=?", [result.error?.slice(0,200), conn.id]);
    }

    res.json({
      provider,
      direction,
      entity_type,
      ...result,
    });
  } catch (e) {
    logger.error(`[integrations/${req.params.provider}/sync]`, e.message);
    res.status(500).json({ error: 'Sync failed.', detail: e.message });
  }
});

// GET /api/integrations/:provider/sync/log
router.get('/:provider/sync/log', authRequired, requireFirmRole('partner'), async (req, res) => {
  try {
    const db       = await getDb();
    const ctx      = req.firmCtx;
    const provider = sanitizeStr(req.params.provider, 50);

    const conn = await db.get('SELECT id FROM integration_connections WHERE firm_id=? AND provider=?', [ctx.firm_id, provider]);
    if (!conn) return err404(res, `No ${provider} connection found.`);

    const limit = Math.min(safeInt(req.query.limit || '20'), 100);
    const log   = await db.all(
      `SELECT id, connection_id, sync_type, status, records_synced, error, created_at FROM integration_sync_log WHERE connection_id=? ORDER BY created_at DESC LIMIT ?`,
      [conn.id, limit]
    );

    res.json({ provider, log, count: log.length });
  } catch (e) {
    res.status(500).json({ error: 'Could not load sync log.' });
  }
});

export default router;
