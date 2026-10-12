/**
 * audit11 H8 — SAML ACS. Verification is done by @node-saml/node-saml; these
 * tests forge real XML-DSig responses (openssl-generated IdP key/cert,
 * xml-crypto signer) and prove:
 *   • a correctly signed assertion logs in (legit flow, SP- and IdP-initiated);
 *   • unsigned, wrong-key, tampered and signature-WRAPPED responses are refused;
 *   • replayed assertions are refused; unconfigured / cert-less firms are refused;
 *   • SSO cannot take over an existing account outside the firm, and an IdP
 *     "firm_admin" role claim is not honoured.
 */
import { execFileSync } from 'child_process';
import fs   from 'fs';
import os   from 'os';
import path from 'path';
import { randomBytes } from 'crypto';
import { SignedXml } from 'xml-crypto';
import { describeIntegration, initSecuritySuite } from './_world.js';

const SP_BASE   = process.env.BASE_URL || process.env.CORS_ORIGIN || 'https://justicegavel.app';
const SP_ENTITY = `${SP_BASE}/api/sso/metadata`;
const SP_ACS    = `${SP_BASE}/api/sso/acs`;
const IDP       = 'https://idp.example-firm.test/saml';

function makeKeyPair(dir, name) {
  const key = path.join(dir, `${name}.key`), crt = path.join(dir, `${name}.crt`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt,
    '-days', '2', '-subj', `/CN=${name}`], { stdio: 'ignore' });
  return { key: fs.readFileSync(key, 'utf8'), cert: fs.readFileSync(crt, 'utf8') };
}

function assertionXml({ id, email, role = null, name = 'SSO User', issuer = IDP, audience = SP_ENTITY }) {
  const now = new Date(), later = new Date(Date.now() + 5 * 60_000), earlier = new Date(Date.now() - 60_000);
  return `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${now.toISOString()}">`
    + `<saml:Issuer>${issuer}</saml:Issuer>`
    + `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID>`
    + `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${later.toISOString()}" Recipient="${SP_ACS}"/></saml:SubjectConfirmation></saml:Subject>`
    + `<saml:Conditions NotBefore="${earlier.toISOString()}" NotOnOrAfter="${later.toISOString()}"><saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>`
    + `<saml:AuthnStatement AuthnInstant="${now.toISOString()}" SessionIndex="_s${id}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>`
    + `<saml:AttributeStatement><saml:Attribute Name="displayName"><saml:AttributeValue>${name}</saml:AttributeValue></saml:Attribute>`
    + (role ? `<saml:Attribute Name="role"><saml:AttributeValue>${role}</saml:AttributeValue></saml:Attribute>` : '')
    + `</saml:AttributeStatement></saml:Assertion>`;
}

function responseXml(inner) {
  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${randomBytes(8).toString('hex')}" Version="2.0" IssueInstant="${new Date().toISOString()}" Destination="${SP_ACS}">`
    + `<saml:Issuer>${IDP}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>`
    + inner + `</samlp:Response>`;
}

function signAssertion(xml, assertionId, { key, cert }) {
  const sig = new SignedXml({
    privateKey: key, publicCert: cert,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  sig.addReference({
    xpath: `//*[local-name(.)='Assertion' and @ID='${assertionId}']`,
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  sig.computeSignature(xml, { location: { reference: `//*[local-name(.)='Assertion' and @ID='${assertionId}']/*[local-name(.)='Issuer']`, action: 'after' } });
  return sig.getSignedXml();
}

const b64 = (s) => Buffer.from(s).toString('base64');
const newId = () => `_a${randomBytes(10).toString('hex')}`;

describeIntegration('H8 — SAML assertion verification', () => {
  const ctx = initSecuritySuite();
  let tmp, idp, attackerKeys, firmAdmin, outsider, firmId, relay;

  beforeAll(async () => {
    if (!ctx.app) return;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jg-saml-'));
    idp = makeKeyPair(tmp, 'idp');
    attackerKeys = makeKeyPair(tmp, 'attacker');
    firmAdmin = await ctx.persona('SsoAdmin', { attorney: true });
    outsider  = await ctx.persona('VictimConsumer');
    firmId    = await ctx.makeFirm(firmAdmin, 'SSO Firm');
    // A config WITHOUT a certificate is not accepted
    const noCert = await ctx.request().post(`/api/sso/config/${firmId}`).set(firmAdmin.headers)
      .send({ entity_id: IDP, sso_url: 'https://idp.example-firm.test/sso' });
    expect(noCert.status).toBe(400);
    const cfg = await ctx.request().post(`/api/sso/config/${firmId}`).set(firmAdmin.headers)
      .send({ entity_id: IDP, sso_url: 'https://idp.example-firm.test/sso', certificate: idp.cert, attribute_role: 'role' });
    expect(cfg.status).toBe(200);
    const login = await ctx.request().get(`/api/sso/login?firm=${firmId}`);
    expect(login.status).toBe(302);
    relay = new URL(login.headers.location).searchParams.get('RelayState');
    expect(relay).toBeTruthy();
    ctx.addCleanup(async (db) => {
      await db.run(`DELETE FROM sso_request_cache WHERE cache_key LIKE ?`, [`assertion:${firmId}:%`]);
      await db.run(`DELETE FROM firm_members WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)`, [`%@sso-${ctx.tag}.test`]);
      await db.run(`DELETE FROM users WHERE email LIKE ?`, [`%@sso-${ctx.tag}.test`]);
    });
  });
  afterAll(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

  const acs = (xml, { relayState = relay, query = '' } = {}) =>
    ctx.request().post(`/api/sso/acs${query}`).type('form').send({ SAMLResponse: b64(xml), RelayState: relayState });

  it('LEGIT: a correctly signed assertion signs the user in (new account provisioned as associate)', async () => {
    const id = newId();
    const email = `newhire@sso-${ctx.tag}.test`;
    const xml = responseXml(signAssertion(assertionXml({ id, email, role: 'firm_admin', name: 'New Hire' }), id, idp));
    const r = await acs(xml);
    expect(r.status).toBe(302);
    const token = new URL(r.headers.location).searchParams.get('token');
    expect(token).toBeTruthy();
    const me = await ctx.request().get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);
    const fm = await ctx.db.get('SELECT firm_role FROM firm_members WHERE firm_id = ? AND user_id = ?', [firmId, me.body.id]);
    expect(fm.firm_role).toBe('associate');           // IdP "firm_admin" claim not honoured
  });

  it('ATTACK: replaying the same signed assertion is refused', async () => {
    const id = newId();
    const xml = responseXml(signAssertion(assertionXml({ id, email: `replay@sso-${ctx.tag}.test` }), id, idp));
    expect((await acs(xml)).status).toBe(302);
    const again = await acs(xml);
    expect(again.status).toBe(401);
    expect(again.body.code).toBe('saml_replay');
  });

  it('ATTACK: an UNSIGNED assertion is refused', async () => {
    const r = await acs(responseXml(assertionXml({ id: newId(), email: `unsigned@sso-${ctx.tag}.test` })));
    expect(r.status).toBe(401);
    expect(r.headers.location).toBeUndefined();
  });

  it('ATTACK: an assertion signed with the attacker\'s own key is refused', async () => {
    const id = newId();
    const r = await acs(responseXml(signAssertion(assertionXml({ id, email: `forged@sso-${ctx.tag}.test` }), id, attackerKeys)));
    expect(r.status).toBe(401);
  });

  it('ATTACK: tampering with a signed assertion (email swapped after signing) is refused', async () => {
    const id = newId();
    const signed = signAssertion(assertionXml({ id, email: `alice@sso-${ctx.tag}.test` }), id, idp);
    const tampered = signed.replace(`alice@sso-${ctx.tag}.test`, `ceo@sso-${ctx.tag}.test`);
    expect((await acs(responseXml(tampered))).status).toBe(401);
  });

  it('ATTACK: signature wrapping — evil unsigned assertion placed before a validly signed one', async () => {
    const goodId = newId();
    const signedGood = signAssertion(assertionXml({ id: goodId, email: `lowpriv@sso-${ctx.tag}.test` }), goodId, idp);
    const evil = assertionXml({ id: newId(), email: `ceo@sso-${ctx.tag}.test`, role: 'partner' });
    // variant 1: two assertions in the response, the unsigned one first
    const r1 = await acs(responseXml(evil + signedGood));
    if (r1.status === 302) {
      const tok = new URL(r1.headers.location).searchParams.get('token');
      const me = await ctx.request().get('/api/auth/me').set('Authorization', `Bearer ${tok}`);
      expect(me.body.email).not.toBe(`ceo@sso-${ctx.tag}.test`);
    } else {
      expect(r1.status).toBe(401);
    }
    // variant 2: the signed assertion moved inside an Extensions-like wrapper, evil one in its place
    const wrapped = responseXml(`<samlp:Extensions>${signedGood}</samlp:Extensions>` + evil);
    const r2 = await acs(wrapped);
    expect(r2.status).toBe(401);
    const ceo = await ctx.db.get('SELECT id FROM users WHERE email = ?', [`ceo@sso-${ctx.tag}.test`]);
    expect(ceo).toBeUndefined();
  });

  it('ATTACK: wrong audience or wrong issuer is refused', async () => {
    const id1 = newId();
    expect((await acs(responseXml(signAssertion(assertionXml({ id: id1, email: `aud@sso-${ctx.tag}.test`, audience: 'https://other-sp.test' }), id1, idp)))).status).toBe(401);
    const id2 = newId();
    expect((await acs(responseXml(signAssertion(assertionXml({ id: id2, email: `iss@sso-${ctx.tag}.test`, issuer: 'https://evil-idp.test' }), id2, idp)))).status).toBe(401);
  });

  it('ATTACK: SSO cannot take over an existing account that is not a member of the firm', async () => {
    const id = newId();
    const r = await acs(responseXml(signAssertion(assertionXml({ id, email: outsider.email }), id, idp)));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('sso_not_member');
  });

  it('ATTACK: a tampered RelayState is refused; IdP-initiated (?firm=) still verifies the signature', async () => {
    const id = newId();
    const xml = responseXml(signAssertion(assertionXml({ id, email: `idpinit@sso-${ctx.tag}.test` }), id, idp));
    expect((await acs(xml, { relayState: Buffer.from(JSON.stringify({ firm_id: firmId })).toString('base64') })).status).toBe(400);
    const r = await acs(xml, { relayState: '', query: `?firm=${firmId}` });
    expect(r.status).toBe(302);
  });

  it('ATTACK: a firm whose stored config has no certificate never accepts assertions', async () => {
    await ctx.db.run(`UPDATE sso_configurations SET certificate = '' WHERE firm_id = ?`, [firmId]);
    const id = newId();
    const r = await acs(responseXml(assertionXml({ id, email: `nocert@sso-${ctx.tag}.test` })));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('sso_not_configured');
    await ctx.db.run(`UPDATE sso_configurations SET certificate = ? WHERE firm_id = ?`, [idp.cert, firmId]);
  });
});
