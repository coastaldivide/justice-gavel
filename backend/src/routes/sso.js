/**
 * routes/sso.js — SSO / SAML 2.0 Integration
 *
 * Justice Gavel acts as the Service Provider (SP).
 * Firm IT configures their IdP (Okta, Azure AD, Google Workspace) to trust us.
 *
 * Endpoints:
 *   GET  /api/sso/metadata                    — SP metadata XML (share with IdP admin)
 *   GET  /api/sso/login?firm=<slug>           — initiate IdP redirect
 *   POST /api/sso/acs                         — Assertion Consumer Service (IdP posts here)
 *   POST /api/sso/logout                      — Single Logout (SLO)
 *   GET  /api/sso/config/:firmId              — get firm SSO config (firm_admin+)
 *   POST /api/sso/config/:firmId              — create/update firm SSO config (firm_admin+)
 *   DELETE /api/sso/config/:firmId            — disable SSO for firm (firm_admin+)
 *   GET  /api/sso/test/:firmId                — test SSO config (firm_admin+)
 *
 * SAML flow:
 *   1. User visits /api/sso/login?firm=skadden
 *   2. We look up their firm's IdP config
 *   3. We redirect to IdP SSO URL with a signed AuthnRequest
 *   4. IdP authenticates and POSTs a SAMLResponse to /api/sso/acs
 *   5. We validate the response signature using firm's certificate
 *   6. We extract email/name, find or create the user, issue a JWT
 *   7. We redirect to the app with ?token=<jwt>
 *
 * SAML parsing and signature verification use @node-saml/node-saml (see the
 * "SAML (H8)" block below) — never hand-rolled regexes over the XML.
 */

import { Router }          from 'express';
import { asyncRoute, err400, err403, err404, safeInt, sanitizeStr, truncateStr } from '../utils/routeHelpers.js';
import { getDb }           from '../db/index.js';
import { authRequired, invalidateUserCache } from '../middleware/auth.js';
import { requireFirmRole } from '../middleware/rbac.js';
import { writeAuditLog }   from '../middleware/audit.js';
import { CONFIG }          from '../config.js';
import jwt                 from 'jsonwebtoken';
import logger              from '../utils/logger.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import rateLimit from 'express-rate-limit';

const routeLimiter = makeUserLimiter({ windowMs: 60_000, max: 30 }); // 30 req/min per user
const ssoLimiter   = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

const router = Router();

// ── SP configuration ──────────────────────────────────────────────────────────
const BASE_URL     = process.env.BASE_URL || process.env.CORS_ORIGIN || 'https://justicegavel.app';
const SP_ENTITY_ID = `${BASE_URL}/api/sso/metadata`;
const SP_ACS_URL   = `${BASE_URL}/api/sso/acs`;
const APP_REDIRECT = process.env.APP_SSO_REDIRECT || `${BASE_URL}/auth/sso-callback`;

// ── SAML (H8) ─────────────────────────────────────────────────────────────────
// All XML signature work is done by @node-saml/node-saml (xml-crypto underneath):
// it canonicalises, verifies the Reference/DigestValue of the signed element,
// extracts the profile ONLY from the element the signature covers (so
// signature-wrapping — a second, unsigned Assertion next to a signed one — is
// rejected), and checks Issuer, Audience, Destination/Recipient, NotBefore /
// NotOnOrAfter and (for SP-initiated logins) InResponseTo.
// Policy on top of the library:
//   • an SSO config without an IdP certificate is "not configured" — rejected;
//   • the Assertion itself must be signed (wantAssertionsSigned);
//   • assertion IDs are single-use (replay cache in sso_request_cache);
//   • SSO can sign in an EXISTING account only if it is already an active member
//     of that firm; otherwise it may create a NEW account. It can never take over
//     an account that belongs to someone outside the firm;
//   • an IdP role claim maps only to non-admin firm tiers (never firm_admin/super_admin).
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import { X509Certificate, createHmac, timingSafeEqual } from 'crypto';

const SSO_PROVISIONABLE_ROLES = new Set(['partner', 'associate', 'paralegal', 'viewer', 'client']);
const RELAY_TTL_MS = 10 * 60 * 1000;

/** DB-backed cache so InResponseTo / replay checks work across instances. */
function dbCacheProvider(db, kind) {
  return {
    async saveAsync(key, value) {
      await db.run(
        `INSERT INTO sso_request_cache (cache_key, kind, value, created_at) VALUES (?,?,?,NOW())
         ON CONFLICT (cache_key) DO NOTHING`, [`${kind}:${key}`, kind, String(value)]);
      return { value: String(value), createdAt: Date.now() };
    },
    async getAsync(key) {
      const row = await db.get(
        `SELECT value FROM sso_request_cache WHERE cache_key=? AND created_at > NOW() - INTERVAL '1 hour'`,
        [`${kind}:${key}`]);
      return row ? row.value : null;
    },
    async removeAsync(key) {
      if (key == null) return null;
      const row = await this.getAsync(key);
      await db.run('DELETE FROM sso_request_cache WHERE cache_key=?', [`${kind}:${key}`]);
      return row;
    },
  };
}

function normalizeCert(certPem) {
  const body = String(certPem || '')
    .replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, '');
  return body.length >= 100 ? body : null;
}

/** node-saml instance for one firm's IdP configuration. */
export function samlForConfig(ssoConfig, db) {
  const cert = normalizeCert(ssoConfig?.certificate);
  if (!cert) return null;
  return new SAML({
    callbackUrl:           SP_ACS_URL,
    entryPoint:            ssoConfig.sso_url,
    issuer:                SP_ENTITY_ID,
    audience:              SP_ENTITY_ID,
    idpCert:               cert,
    idpIssuer:             ssoConfig.entity_id ? String(ssoConfig.entity_id) : undefined,
    wantAssertionsSigned:  true,
    wantAuthnResponseSigned: false,
    acceptedClockSkewMs:   2 * 60 * 1000,
    maxAssertionAgeMs:     10 * 60 * 1000,
    validateInResponseTo:  ValidateInResponseTo.ifPresent,
    requestIdExpirationPeriodMs: 10 * 60 * 1000,
    cacheProvider:         dbCacheProvider(db, 'authn'),
    disableRequestedAuthnContext: true,
    identifierFormat:      'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  });
}

/** HMAC-signed RelayState carrying the firm id (tamper-evident, short-lived). */
function signRelayState(firmId) {
  const payload = Buffer.from(JSON.stringify({ f: Number(firmId), t: Date.now() })).toString('base64url');
  const mac = createHmac('sha256', process.env.JWT_SECRET).update(`sso-relay.${payload}`).digest('base64url');
  return `${payload}.${mac}`;
}
function verifyRelayState(rs) {
  const [payload, mac] = String(rs || '').split('.');
  if (!payload || !mac) return null;
  const expect = createHmac('sha256', process.env.JWT_SECRET).update(`sso-relay.${payload}`).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const st = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!Number.isInteger(st.f) || Date.now() - Number(st.t) > RELAY_TTL_MS) return null;
    return st.f;
  } catch { return null; }
}

function profileAttr(profile, name) {
  if (!name || !profile) return null;
  const v = profile[name] ?? profile.attributes?.[name];
  const one = Array.isArray(v) ? v[0] : v;
  return typeof one === 'string' && one.trim() ? one.trim() : null;
}

/** Issue a JWT for an SSO-authenticated user (role is re-read from the DB on every request). */
function issueJwt(user) {
  const payload = {
    id:          user.id,
    role:        user.role || 'user',
    email:       user.email || null,
    displayName: user.display_name || user.name || user.email,
    premium:     !!user.is_premium,
    sso:         true,
  };
  return jwt.sign(
    payload,
    process.env.JWT_SECRET,   // always set: required in production, generated per-process in dev (config.js)
    { expiresIn: CONFIG.JWT_EXPIRES_IN || '30d', algorithm: 'HS256' }
  );
}

const SSO_CONFIG_COLS = `id, firm_id, provider, entity_id, sso_url, slo_url, certificate,
              attribute_email, attribute_name, attribute_role, force_sso, active`;

// ══════════════════════════════════════════════════════════════════════════════
// SP METADATA — share this URL with IdP administrators
// ══════════════════════════════════════════════════════════════════════════════
router.get('/metadata', (req, res) => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor
  xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="${SP_ENTITY_ID}">
  <md:SPSSODescriptor
    AuthnRequestsSigned="false"
    WantAssertionsSigned="true"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${SP_ACS_URL}"
      index="1"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;

  res.set('Content-Type', 'application/xml');
  res.send(xml);
});

// ══════════════════════════════════════════════════════════════════════════════
// INITIATE SSO LOGIN — redirect user to IdP
// GET /api/sso/login?firm=<slug>
// ══════════════════════════════════════════════════════════════════════════════
router.get('/login', ssoLimiter, async (req, res) => {
  try {
    const { firm } = req.query;
    if (!firm) return err400(res, 'firm parameter required (firm slug or ID)');

    const db  = await getDb();
    // Look up firm by slug or ID
    const firmRow = await db.get(
      'SELECT id, name FROM firms WHERE slug=? OR id=? LIMIT 1',
      [sanitizeStr(String(firm), 100), safeInt(firm)]
    );
    if (!firmRow) return err404(res, 'Firm not found.');

    const ssoConfig = await db.get(
      `SELECT ${SSO_CONFIG_COLS} FROM sso_configurations WHERE firm_id=? AND active=1 LIMIT 1`,
      [firmRow.id]
    );
    const saml = ssoConfig && /^https:\/\//i.test(String(ssoConfig.sso_url || '')) ? samlForConfig(ssoConfig, db) : null;
    if (!saml) {
      return res.status(400).json({
        error: 'SSO is not configured for this firm. Contact your IT administrator.',
        code:  'sso_not_configured',
      });
    }

    const redirectUrl = await saml.getAuthorizeUrlAsync(signRelayState(firmRow.id), req.get('host'), {});

    await writeAuditLog(db, {
      firm_id:   firmRow.id,
      action:    'sso_login_initiated',
      resource:  'sso',
      ip:        req.ip,
      ua:        req.headers['user-agent'],
    });

    res.redirect(302, redirectUrl);
  } catch (e) {
    logger.error('[sso/login]', e.message);
    res.status(500).json({ error: 'SSO initiation failed.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ASSERTION CONSUMER SERVICE — IdP posts SAMLResponse here
// POST /api/sso/acs   (firm from the signed RelayState, or ?firm=<id> for IdP-initiated)
// ══════════════════════════════════════════════════════════════════════════════
router.post('/acs', ssoLimiter, async (req, res) => {
  let db, firmId = null;
  try {
    const { SAMLResponse, RelayState } = req.body || {};
    if (!SAMLResponse || typeof SAMLResponse !== 'string') return err400(res, 'SAMLResponse missing.');
    if (SAMLResponse.length > 256 * 1024) return res.status(413).json({ error: 'SAMLResponse too large.' });

    firmId = verifyRelayState(RelayState) ?? (safeInt(req.query.firm) || null);
    if (!firmId) return err400(res, 'Invalid RelayState.');

    db = await getDb();
    const ssoConfig = await db.get(
      `SELECT ${SSO_CONFIG_COLS} FROM sso_configurations WHERE firm_id=? AND active=1 LIMIT 1`,
      [firmId]
    );
    const saml = ssoConfig ? samlForConfig(ssoConfig, db) : null;
    // Never accept an assertion for a firm without a verifiable IdP certificate.
    if (!saml) return res.status(400).json({ error: 'SSO is not configured for this firm.', code: 'sso_not_configured' });

    let profile;
    try {
      ({ profile } = await saml.validatePostResponseAsync({ SAMLResponse }));
    } catch (e) {
      logger.warn({ firmId, err: e?.message }, '[sso/acs] SAML validation failed');
      await writeAuditLog(db, { firm_id: firmId, action: 'sso_signature_fail', resource: 'sso', ip: req.ip }).catch(() => {});
      return res.status(401).json({ error: 'SAML response could not be verified.', code: 'saml_invalid' });
    }
    if (!profile) return res.status(401).json({ error: 'SAML response could not be verified.', code: 'saml_invalid' });
    // The SIGNED assertion's own Issuer must be this firm's IdP (node-saml checks the
    // Response-level Issuer; the assertion is what we trust).
    if (!ssoConfig.entity_id || profile.issuer !== String(ssoConfig.entity_id)) {
      logger.warn({ firmId, issuer: profile.issuer }, '[sso/acs] assertion issuer mismatch');
      return res.status(401).json({ error: 'SAML response could not be verified.', code: 'saml_invalid' });
    }

    // Single-use assertions (replay protection).
    const assertionId = profile.getAssertion?.()?.Assertion?.$?.ID || null;
    if (!assertionId) return res.status(401).json({ error: 'SAML assertion has no ID.', code: 'saml_invalid' });
    const replay = await db.run(
      `INSERT INTO sso_request_cache (cache_key, kind, value, created_at) VALUES (?, 'assertion', ?, NOW())
       ON CONFLICT (cache_key) DO NOTHING`, [`assertion:${firmId}:${assertionId}`, String(firmId)]);
    if (!replay.changes) return res.status(401).json({ error: 'SAML assertion was already used.', code: 'saml_replay' });

    // Extract user attributes — only from the verified profile.
    const emailAttr  = ssoConfig.attribute_email  || 'email';
    const nameAttr   = ssoConfig.attribute_name   || 'displayName';
    const roleAttr   = ssoConfig.attribute_role;
    const email   = profile.nameID?.includes('@') ? profile.nameID
                  : (profileAttr(profile, emailAttr) || profileAttr(profile, 'email') || profile.mail || null);
    const name    = profileAttr(profile, nameAttr) || profileAttr(profile, 'displayName') || profileAttr(profile, 'cn');
    const idpRole = roleAttr ? profileAttr(profile, roleAttr) : null;

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'Could not extract valid email from SAML assertion.' });
    }

    const safeEmail = email.toLowerCase().trim();
    const safeName  = truncateStr(name || safeEmail.split('@')[0], 100);

    // Find or create user — never take over an account outside this firm.
    let user = await db.get('SELECT id, email, role, display_name, name, is_premium, account_status FROM users WHERE LOWER(email)=? LIMIT 1', [safeEmail]);
    let firmMember = null;
    if (user) {
      firmMember = await db.get(
        `SELECT fm.firm_role, fm.role FROM firm_members fm
          WHERE fm.firm_id=? AND fm.user_id=? AND COALESCE(fm.active,1)=1 AND COALESCE(fm.status,'active')='active'`,
        [firmId, user.id]);
      if (!firmMember) {
        logger.warn({ firmId, userId: user.id }, '[sso/acs] refused: existing account is not a member of this firm');
        await writeAuditLog(db, { firm_id: firmId, action: 'sso_account_not_member', resource: 'sso', ip: req.ip }).catch(() => {});
        return res.status(403).json({ error: 'This account is not a member of the firm. Ask your firm administrator to invite it.', code: 'sso_not_member' });
      }
      if (['banned', 'suspended', 'deleted', 'disabled'].includes(String(user.account_status || 'active'))) {
        return res.status(403).json({ error: 'This account is disabled.', code: 'account_disabled' });
      }
    } else {
      const r = await db.run(
        `INSERT INTO users (email, display_name, name, password_hash, role, login_identifier)
         VALUES (?,?,?,?,?,?)`,
        [safeEmail, safeName, safeName, 'sso_no_password', 'user', safeEmail]
      );
      user = await db.get('SELECT id, email, role, display_name, name, is_premium FROM users WHERE id=? LIMIT 1', [r.lastID]);
      const provisionedRole = SSO_PROVISIONABLE_ROLES.has(idpRole) ? idpRole : 'associate';
      await db.run(
        `INSERT INTO firm_members (firm_id, user_id, firm_role, role, status, active)
         VALUES (?,?,?,?,'active',1) ON CONFLICT DO NOTHING`,
        [firmId, user.id, provisionedRole, provisionedRole]
      );
      firmMember = { firm_role: provisionedRole };
    }
    invalidateUserCache(user.id);

    // Issue JWT and redirect to app
    const token = issueJwt(user);

    await writeAuditLog(db, {
      user_id:  user.id,
      firm_id:  firmId,
      action:   'sso_login',
      resource: 'sso',
      detail:   JSON.stringify({ email: safeEmail, idp_role: idpRole }),
      ip:       req.ip,
      ua:       req.headers['user-agent'],
    });

    const redirectUrl = `${APP_REDIRECT}?token=${encodeURIComponent(token)}&firm_id=${firmId}`;
    res.redirect(302, redirectUrl);
  } catch (e) {
    logger.error('[sso/acs]', e.message);
    res.status(500).json({ error: 'SSO authentication failed.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// SINGLE LOGOUT (SLO)
// POST /api/sso/logout
// ══════════════════════════════════════════════════════════════════════════════
router.post('/logout', authRequired, routeLimiter, async (req, res) => {
  try {
    const db  = await getDb();
    // Clear push token to prevent stale notifications
    await db.run('UPDATE users SET push_token=NULL WHERE id=?', [req.user.id]).catch(() => {});

    await writeAuditLog(db, {
      user_id:  req.user.id,
      action:   'sso_logout',
      resource: 'sso',
      ip:       req.ip,
      ua:       req.headers['user-agent'],
    });

    res.json({ ok: true, message: 'SSO session terminated.' });
  } catch (e) {
    logger.error('[sso/logout]', e.message);
    res.status(500).json({ error: 'Logout failed.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// SSO CONFIGURATION MANAGEMENT (firm_admin only)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/sso/config/:firmId — get SSO config
router.get('/config/:firmId', authRequired, requireFirmRole('firm_admin'), async (req, res) => {
  try {
    const db     = await getDb();
    const ctx    = req.firmCtx;
    const firmId = safeInt(req.params.firmId);
    if (!ctx || Number(ctx.firm_id) !== firmId) return err403(res, 'Access denied to this firm.');

    const config = await db.get(
      `SELECT id, firm_id, provider, entity_id, sso_url, slo_url,
              attribute_email, attribute_name, attribute_role,
              sp_entity_id, sp_acs_url, force_sso, active, created_at, updated_at
       FROM sso_configurations WHERE firm_id=?`,
      [firmId]
    );

    if (!config) return res.json({ configured: false, sp_entity_id: SP_ENTITY_ID, sp_acs_url: SP_ACS_URL });

    // Never return the certificate in full — just confirm it's present
    res.json({
      ...config,
      certificate_configured: true,
      sp_entity_id: SP_ENTITY_ID,
      sp_acs_url:   SP_ACS_URL,
    });
  } catch (e) {
    logger.error('[sso/config/get]', e.message);
    res.status(500).json({ error: 'Could not load SSO config.' });
  }
});

// POST /api/sso/config/:firmId — create or update SSO config
router.post('/config/:firmId', authRequired, routeLimiter, requireFirmRole('firm_admin'), async (req, res) => {
  try {
    const db     = await getDb();
    const ctx    = req.firmCtx;
    const firmId = safeInt(req.params.firmId);
    if (!ctx || Number(ctx.firm_id) !== firmId) return err403(res, 'Access denied to this firm.');

    const {
      provider        = 'saml',
      entity_id, sso_url, slo_url, certificate,
      attribute_email = 'email',
      attribute_name  = 'displayName',
      attribute_role  = null,
      force_sso       = 0,
    } = req.body || {};

    if (!sso_url) return err400(res, 'sso_url (IdP SSO endpoint) is required.');
    if (!entity_id) return err400(res, 'entity_id (IdP entity ID / issuer) is required.');
    if (!certificate) return err400(res, 'certificate (IdP public X.509 certificate, PEM) is required.');

    // Validate certificate: it must parse as an X.509 certificate.
    const certClean = normalizeCert(certificate);
    try {
      if (!certClean) throw new Error('empty');
      new X509Certificate(`-----BEGIN CERTIFICATE-----\n${certClean.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`);
    } catch {
      return err400(res, 'certificate appears invalid. Provide the full PEM certificate from your IdP.');
    }
    if (!/^https:\/\//i.test(String(sso_url))) return err400(res, 'sso_url must be an https:// URL.');

    const PROVIDERS = ['saml', 'okta', 'azure_ad', 'google', 'ping', 'onelogin'];
    const safeProvider = PROVIDERS.includes(provider) ? provider : 'saml';

    const existing = await db.get('SELECT id FROM sso_configurations WHERE firm_id=?', [firmId]);

    if (existing) {
      await db.run(
        `UPDATE sso_configurations SET
          provider=?, entity_id=?, sso_url=?, slo_url=?, certificate=?,
          attribute_email=?, attribute_name=?, attribute_role=?,
          sp_entity_id=?, sp_acs_url=?, force_sso=?, active=1,
          updated_at=NOW()
         WHERE firm_id=?`,
        [safeProvider, entity_id, sso_url, slo_url || null, certificate,
         attribute_email, attribute_name, attribute_role || null,
         SP_ENTITY_ID, SP_ACS_URL, force_sso ? 1 : 0, firmId]
      );
    } else {
      await db.run(
        `INSERT INTO sso_configurations
          (firm_id, provider, entity_id, sso_url, slo_url, certificate,
           attribute_email, attribute_name, attribute_role,
           sp_entity_id, sp_acs_url, force_sso, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [firmId, safeProvider, entity_id, sso_url, slo_url || null, certificate,
         attribute_email, attribute_name, attribute_role || null,
         SP_ENTITY_ID, SP_ACS_URL, force_sso ? 1 : 0, req.user.id]
      );
    }

    await writeAuditLog(db, {
      user_id:   req.user.id,
      firm_id:   firmId,
      action:    existing ? 'sso_config_updated' : 'sso_config_created',
      resource:  'sso',
      detail:    JSON.stringify({ provider: safeProvider, entity_id, force_sso }),
      ip:        req.ip,
      ua:        req.headers['user-agent'],
    });

    res.json({
      ok:           true,
      configured:   true,
      provider:     safeProvider,
      sp_entity_id: SP_ENTITY_ID,
      sp_acs_url:   SP_ACS_URL,
      login_url:    `${BASE_URL}/api/sso/login?firm=${firmId}`,
      force_sso:    !!force_sso,
    });
  } catch (e) {
    logger.error('[sso/config/save]', e.message);
    res.status(500).json({ error: 'Could not save SSO configuration.' });
  }
});

// DELETE /api/sso/config/:firmId — disable SSO
router.delete('/config/:firmId', authRequired, requireFirmRole('firm_admin'), async (req, res) => {
  try {
    const db     = await getDb();
    const ctx    = req.firmCtx;
    const firmId = safeInt(req.params.firmId);
    if (!ctx || Number(ctx.firm_id) !== firmId) return err403(res, 'Access denied to this firm.');

    await db.run("UPDATE sso_configurations SET active=0 WHERE firm_id=?", [firmId]);
    await writeAuditLog(db, {
      user_id: req.user.id, firm_id: firmId,
      action: 'sso_disabled', resource: 'sso', ip: req.ip,
    });
    res.json({ ok: true, message: 'SSO disabled. Users can now log in with password.' });
  } catch (e) {
    logger.error('[sso/config/delete]', e.message);
    res.status(500).json({ error: 'Could not disable SSO.' });
  }
});

// GET /api/sso/test/:firmId — verify config is reachable (no actual SAML exchange)
router.get('/test/:firmId', authRequired, requireFirmRole('firm_admin'), asyncRoute(async (req, res) => {
  try {
    const db     = await getDb();
    const ctx    = req.firmCtx;
    const firmId = safeInt(req.params.firmId);
    if (!ctx || Number(ctx.firm_id) !== firmId) return err403(res, 'Access denied to this firm.');

    const config = await db.get(
      'SELECT id, provider, entity_id, sso_url, slo_url, certificate, force_sso, active FROM sso_configurations WHERE firm_id=? AND active=1 LIMIT 1', [firmId]);
    if (!config) return err404(res, 'No active SSO configuration found.');

    const checks = {
      entity_id_set:    !!config.entity_id,
      sso_url_set:      !!config.sso_url,
      certificate_set:  !!config.certificate,
      sp_entity_id:     SP_ENTITY_ID,
      sp_acs_url:       SP_ACS_URL,
      login_url:        `${BASE_URL}/api/sso/login?firm=${firmId}`,
      force_sso:        !!config.force_sso,
      provider:         config.provider,
    };

    const allGood = checks.entity_id_set && checks.sso_url_set && checks.certificate_set;
    res.json({ ok: allGood, checks });
  } catch (e) {
    logger.error('[sso/test]', e.message);
    res.status(500).json({ error: 'Could not test SSO configuration.' });
  }

}));
export default router;