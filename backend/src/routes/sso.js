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
 * No external SAML library required — we use Node.js built-in crypto + XML.
 * This handles the 95% case (Okta/Azure/Google). For edge cases (multi-cert,
 * signed assertions with encryption) recommend saml2-js in production.
 */

import { Router }          from 'express';
import { randomUUID }      from 'crypto';
import { createVerify }    from 'crypto';
import { getDb }           from '../db/index.js';
import { authRequired }    from '../middleware/auth.js';
import { requireFirmRole, loadFirmContext } from '../middleware/rbac.js';
import { writeAuditLog }   from '../middleware/audit.js';
import { err400, err403, err404, safeInt,
         sanitizeStr, truncateStr }         from '../utils/routeHelpers.js';
import { CONFIG }          from '../config.js';
import jwt                 from 'jsonwebtoken';
import logger              from '../utils/logger.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';

const routeLimiter = makeUserLimiter(30, 60_000); // 30 req/min per user

const router = Router();

// ── SP configuration ──────────────────────────────────────────────────────────
const BASE_URL     = process.env.BASE_URL || process.env.CORS_ORIGIN || 'https://justicegavel.app';
const SP_ENTITY_ID = `${BASE_URL}/api/sso/metadata`;
const SP_ACS_URL   = `${BASE_URL}/api/sso/acs`;
const APP_REDIRECT = process.env.APP_SSO_REDIRECT || `${BASE_URL}/auth/sso-callback`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalize party name for conflict index lookups */
function normalizeName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

/** Build a minimal SAML AuthnRequest XML */
function buildAuthnRequest(idpSsoUrl, issuer, acsUrl) {
  const id  = '_' + randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<samlp:AuthnRequest
  xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
  ID="${id}"
  Version="2.0"
  IssueInstant="${now}"
  Destination="${idpSsoUrl}"
  AssertionConsumerServiceURL="${acsUrl}"
  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
  <saml:Issuer>${issuer}</saml:Issuer>
  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>
</samlp:AuthnRequest>`;
  return { id, xml };
}

/** Base64-encode XML for HTTP-Redirect binding */
function encodeRedirect(xml) {
  return Buffer.from(xml).toString('base64').replace(/\s/g, '');
}

/** Decode base64 SAML response */
function decodeSamlResponse(encoded) {
  try {
    return Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

/** Extract an attribute value from SAML XML (simple regex — no full XML parser) */
function extractAttr(xml, attrName) {
  // Attribute name match
  const byName = new RegExp(`Name="${attrName}"[^>]*>[\\s\\S]*?<saml[^:]*:AttributeValue[^>]*>([^<]+)`, 'i');
  const m1 = xml.match(byName);
  if (m1) return m1[1].trim();

  // Friendly name match
  const byFriendly = new RegExp(`FriendlyName="${attrName}"[^>]*>[\\s\\S]*?<saml[^:]*:AttributeValue[^>]*>([^<]+)`, 'i');
  const m2 = xml.match(byFriendly);
  if (m2) return m2[1].trim();

  return null;
}

/** Extract NameID (email) from SAML assertion */
function extractNameId(xml) {
  const m = xml.match(/<saml[^:]*:NameID[^>]*>([^<]+)<\/saml[^:]*:NameID>/i);
  return m ? m[1].trim() : null;
}

/** Verify SAML signature using IdP certificate */
function verifySamlSignature(xml, certPem) {
  try {
    // Extract the SignatureValue
    const sigMatch = xml.match(/<ds:SignatureValue[^>]*>([^<]+)<\/ds:SignatureValue>/);
    if (!sigMatch) return false; // no signature present

    const sigValue = sigMatch[1].replace(/\s/g, '');

    // Extract SignedInfo (the data that was signed)
    const signedInfoMatch = xml.match(/(<ds:SignedInfo[\s\S]*?<\/ds:SignedInfo>)/);
    if (!signedInfoMatch) return false;

    const signedInfo = signedInfoMatch[1];

    // Normalize certificate — strip headers if present
    const cert = certPem
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s/g, '');
    const pemFormatted = `-----BEGIN CERTIFICATE-----\n${cert.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----`;

    const verify = createVerify('RSA-SHA256');
    verify.update(signedInfo);
    return verify.verify(pemFormatted, sigValue, 'base64');
  } catch (e) {
    logger.warn('[sso] signature verification error:', e.message);
    return false;
  }
}

/** Generate a JWT for an SSO-authenticated user */
function issueJwt(user, firmRole) {
  const payload = {
    id:          user.id,
    email:       user.email || null,
    displayName: user.display_name || user.name || user.email,
    premium:     !!user.is_premium,
    firm_role:   firmRole || null,
    sso:         true,
  };
  return jwt.sign(
    payload,
    process.env.JWT_SECRET || (process.env.NODE_ENV === 'production'
      ? (() => { throw new Error('JWT_SECRET required'); })()
      : 'dev_secret_change_me'),
    { expiresIn: CONFIG.JWT_EXPIRES_IN || '30d' }
  );
}

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
router.get('/login', async (req, res) => {
  try {
    const { firm } = req.query;
    if (!firm) return err400(res, 'firm parameter required (firm slug or ID)');

    const db  = await getDb();
    // Look up firm by slug or ID
    const firmRow = await db.get(
      'SELECT id, name FROM firms WHERE slug=? OR id=? LIMIT 1',
      [sanitizeStr(firm, 100), safeInt(firm)]
    );
    if (!firmRow) return err404(res, 'Firm not found.');

    const ssoConfig = await db.get(
      `SELECT id, firm_id, provider, entity_id, sso_url, slo_url, certificate,
              attribute_email, attribute_name, attribute_role, force_sso, active
       FROM sso_configurations WHERE firm_id=? AND active=1 LIMIT 1`,
      [firmRow.id]
    );
    if (!ssoConfig) {
      return res.status(400).json({
        error: 'SSO is not configured for this firm. Contact your IT administrator.',
        code:  'sso_not_configured',
      });
    }

    const { xml } = buildAuthnRequest(ssoConfig.sso_url, SP_ENTITY_ID, SP_ACS_URL);
    const encoded = encodeRedirect(xml);

    // State parameter encodes firm_id for ACS handler
    const state = Buffer.from(JSON.stringify({ firm_id: firmRow.id })).toString('base64');

    const redirectUrl = `${ssoConfig.sso_url}?SAMLRequest=${encodeURIComponent(encoded)}&RelayState=${encodeURIComponent(state)}`;

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
// POST /api/sso/acs
// ══════════════════════════════════════════════════════════════════════════════
router.post('/acs', async (req, res) => {
  try {
    const { SAMLResponse, RelayState } = req.body || {};
    if (!SAMLResponse) return err400(res, 'SAMLResponse missing.');

    // Decode state to get firm_id
    let firmId = null;
    try {
      const state = JSON.parse(Buffer.from(RelayState || '', 'base64').toString());
      firmId = state.firm_id;
    } catch {
      return err400(res, 'Invalid RelayState.');
    }

    const db = await getDb();
    const ssoConfig = await db.get(
      `SELECT id, firm_id, provider, entity_id, sso_url, slo_url, certificate,
              attribute_email, attribute_name, attribute_role, force_sso, active
       FROM sso_configurations WHERE firm_id=? AND active=1 LIMIT 1`,
      [firmId]
    );
    if (!ssoConfig) return err404(res, 'SSO configuration not found.');

    // Decode and validate SAMLResponse
    const xml = decodeSamlResponse(SAMLResponse);
    if (!xml) return err400(res, 'Invalid SAMLResponse encoding.');

    // Check for success status
    const statusMatch = xml.match(/<samlp:StatusCode[^>]*Value="([^"]+)"/i);
    const status = statusMatch?.[1] || '';
    if (!status.includes('Success')) {
      logger.warn('[sso/acs] IdP returned failure status:', status);
      return res.status(401).json({ error: 'IdP authentication failed.', idp_status: status });
    }

    // Verify signature if certificate configured
    if (ssoConfig.certificate) {
      const valid = verifySamlSignature(xml, ssoConfig.certificate);
      if (!valid) {
        logger.warn('[sso/acs] Signature verification failed for firm', firmId);
        await writeAuditLog(db, {
          firm_id: firmId, action: 'sso_signature_fail', resource: 'sso', ip: req.ip,
        });
        return res.status(401).json({ error: 'SAML signature verification failed.' });
      }
    }

    // Extract user attributes
    const emailAttr  = ssoConfig.attribute_email  || 'email';
    const nameAttr   = ssoConfig.attribute_name   || 'displayName';
    const roleAttr   = ssoConfig.attribute_role;

    const email  = extractNameId(xml) || extractAttr(xml, emailAttr) || extractAttr(xml, 'email');
    const name   = extractAttr(xml, nameAttr) || extractAttr(xml, 'displayName') || extractAttr(xml, 'cn');
    const idpRole = roleAttr ? extractAttr(xml, roleAttr) : null;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Could not extract valid email from SAML assertion.' });
    }

    const safeEmail = email.toLowerCase().trim();
    const safeName  = truncateStr(name || safeEmail.split('@')[0], 100);

    // Find or create user
    let user = await db.get('SELECT id, email, display_name, name, is_premium, firm_role FROM users WHERE email=? LIMIT 1', [safeEmail]);
    if (!user) {
      const r = await db.run(
        `INSERT INTO users (email, display_name, name, password_hash, role, login_identifier)
         VALUES (?,?,?,?,?,?)`,
        [safeEmail, safeName, safeName, 'sso_no_password', 'user', safeEmail]
      );
      user = await db.get('SELECT id, email, display_name, name, is_premium FROM users WHERE id=? LIMIT 1', [r.lastID]);
    } else if (!user.display_name || user.display_name === user.email) {
      // Update display name from IdP if we have one
      await db.run('UPDATE users SET display_name=?, name=? WHERE id=?', [safeName, safeName, user.id]);
    }

    // Resolve firm membership — add if not already a member
    let firmMember = await db.get(
      "SELECT firm_role, status FROM firm_members WHERE firm_id=? AND user_id=? AND status='active'",
      [firmId, user.id]
    );

    if (!firmMember) {
      // Auto-provision with 'associate' role unless IdP provides role claim
      const provisionedRole = idpRole || 'associate';
      await db.run(
        `INSERT OR IGNORE INTO firm_members (firm_id, user_id, firm_role, status)
         VALUES (?,?,?,?)`,
        [firmId, user.id, provisionedRole, 'active']
      );
      firmMember = { firm_role: provisionedRole };
    }

    // Issue JWT and redirect to app
    const token = issueJwt(user, firmMember.firm_role);

    await writeAuditLog(db, {
      user_id:  user.id,
      firm_id:  firmId,
      action:   'sso_login',
      resource: 'sso',
      detail:   JSON.stringify({ email: safeEmail, idp_role: idpRole }),
      ip:       req.ip,
      ua:       req.headers['user-agent'],
    });

    // Redirect to app with token
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
    if (ctx.firm_id !== firmId) return err403(res, 'Access denied to this firm.');

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
    if (ctx.firm_id !== firmId) return err403(res, 'Access denied to this firm.');

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

    // Validate certificate format
    const certClean = certificate.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, '');
    if (!certClean || certClean.length < 100) {
      return err400(res, 'certificate appears invalid. Provide the full PEM certificate from your IdP.');
    }

    const PROVIDERS = ['saml', 'okta', 'azure_ad', 'google', 'ping', 'onelogin'];
    const safeProvider = PROVIDERS.includes(provider) ? provider : 'saml';

    const existing = await db.get('SELECT id FROM sso_configurations WHERE firm_id=?', [firmId]);

    if (existing) {
      await db.run(
        `UPDATE sso_configurations SET
          provider=?, entity_id=?, sso_url=?, slo_url=?, certificate=?,
          attribute_email=?, attribute_name=?, attribute_role=?,
          sp_entity_id=?, sp_acs_url=?, force_sso=?, active=1,
          updated_at=datetime('now')
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
    if (ctx.firm_id !== firmId) return err403(res, 'Access denied to this firm.');

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
router.get('/test/:firmId', authRequired, requireFirmRole('firm_admin'), async (req, res) => {
  try {
    const db     = await getDb();
    const ctx    = req.firmCtx;
    const firmId = safeInt(req.params.firmId);
    if (ctx.firm_id !== firmId) return err403(res, 'Access denied to this firm.');

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
});

export default router;
