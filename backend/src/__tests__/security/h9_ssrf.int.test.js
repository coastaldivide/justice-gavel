/**
 * audit11 H9 — firm webhook subscriptions (and other firm-supplied URLs the
 * server calls) must not reach loopback / private / link-local / metadata
 * addresses.
 *
 * Original attack (verified live): a firm_admin created subscriptions pointing
 * at https://127.0.0.1:5432/, https://127.0.0.1:1/ and
 * https://169.254.169.254/latest/meta-data/ → 201, and delivery would POST there.
 *
 * Proven here against the real app + Postgres:
 *   • creating / updating a subscription with an internal URL → 400 (literal
 *     IPv4/IPv6, IPv4-mapped IPv6, decimal/hex shorthands, internal host names);
 *   • a public-looking host that RESOLVES to an internal address is refused at
 *     send time (DNS rebinding) — nothing is ever sent to it;
 *   • redirects are not followed;
 *   • integration connections refuse internal instance/calendar URLs;
 *   • LEGIT: a real delivery to an allowed receiver is signed and recorded.
 */
import http from 'http';
import { describeIntegration, initSecuritySuite } from './_world.js';
import {
  isBlockedAddress, validateOutboundUrl, safePost, setSsrfTestAllowList,
} from '../../utils/ssrfGuard.js';

const INTERNAL_URLS = [
  'https://127.0.0.1:5432/',
  'https://127.0.0.1:1/',
  'https://169.254.169.254/latest/meta-data/',
  'https://[::1]/',
  'https://[::ffff:127.0.0.1]/',
  'https://[::ffff:a9fe:a9fe]/',          // 169.254.169.254 as mapped hex
  'https://[fd00:ec2::254]/',             // AWS IPv6 metadata
  'https://10.0.0.5/hook',
  'https://192.168.1.10/hook',
  'https://2130706433/',                  // decimal 127.0.0.1
  'https://0x7f000001/',
  'https://localhost/hook',
  'https://metadata.google.internal/computeMetadata/v1/',
  'https://user:pass@example.com/hook',
  'ftp://example.com/hook',
];

describeIntegration('H9 — outbound SSRF protection', () => {
  const ctx = initSecuritySuite();
  let admin, firmId;

  beforeAll(async () => {
    if (!ctx.app) return;
    admin = await ctx.persona('WebhookAdmin', { attorney: true });
    firmId = await ctx.makeFirm(admin, 'H9 Firm');
    ctx.addCleanup(async (db) => {
      await db.run('DELETE FROM webhook_deliveries WHERE subscription_id IN (SELECT id FROM webhook_subscriptions WHERE firm_id = ?)', [firmId]).catch(() => {});
      await db.run('DELETE FROM integration_connections WHERE firm_id = ?', [firmId]).catch(() => {});
    });
  });
  afterAll(() => setSsrfTestAllowList(null));

  it('unit: every internal range is blocked, public addresses are not', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
      '::1', '::', 'fe80::1', 'fc00::1', 'fd00:ec2::254', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::']) {
      expect([ip, isBlockedAddress(ip)]).toEqual([ip, true]);
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) {
      expect([ip, isBlockedAddress(ip)]).toEqual([ip, false]);
    }
    for (const u of INTERNAL_URLS) expect([u, validateOutboundUrl(u).ok]).toEqual([u, false]);
    expect(validateOutboundUrl('https://hooks.example.com/jg').ok).toBe(true);
  });

  it('ATTACK: subscriptions pointing at internal addresses are refused (create and update)', async () => {
    for (const url of INTERNAL_URLS) {
      const r = await ctx.request().post('/api/webhooks/outbound/subscriptions').set(admin.headers)
        .send({ name: 'evil', url, events: ['*'] });
      expect([url, r.status]).toEqual([url, 400]);
    }
    const rows = await ctx.db.all('SELECT url FROM webhook_subscriptions WHERE firm_id = ?', [firmId]);
    expect(rows).toHaveLength(0);
  });

  it('ATTACK: a public host name that resolves to 127.0.0.1 is never contacted (DNS rebinding)', async () => {
    let hits = 0;
    const victim = http.createServer((req, res) => { hits++; res.end('internal'); });
    await new Promise(r => victim.listen(0, '127.0.0.1', r));
    const port = victim.address().port;
    try {
      // "rebinding.example.com" passes static validation; its resolver answers 127.0.0.1.
      const resolver = (host, opts, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]);
      await expect(safePost(`http://rebinding.example.com:${port}/x`, { body: '{}', resolver }))
        .rejects.toMatchObject({ code: 'ESSRFBLOCKED' });
      expect(hits).toBe(0);
    } finally {
      await new Promise(r => victim.close(r));
    }
  });

  it('ATTACK: redirects are not followed', async () => {
    let internalHits = 0;
    const internal = http.createServer((req, res) => { internalHits++; res.end('secret'); });
    await new Promise(r => internal.listen(0, '127.0.0.1', r));
    const redirector = http.createServer((req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${internal.address().port}/` }); res.end();
    });
    await new Promise(r => redirector.listen(0, '127.0.0.1', r));
    try {
      setSsrfTestAllowList([`127.0.0.1/32`]);   // let the request reach the (test) redirector only
      const resolver = (host, opts, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]);
      const r = await safePost(`http://public-hooks.example.com:${redirector.address().port}/`, { body: '{}', resolver });
      expect(r.status).toBe(302);
      expect(r.ok).toBe(false);
      expect(internalHits).toBe(0);
    } finally {
      setSsrfTestAllowList(null);
      await new Promise(r => internal.close(r));
      await new Promise(r => redirector.close(r));
    }
  });

  it('ATTACK: integration connections refuse internal instance / calendar URLs', async () => {
    for (const [field, url] of [['instance_url', 'https://169.254.169.254/latest/meta-data/'], ['calendar_url', 'https://127.0.0.1:5432/cal']]) {
      const r = await ctx.request().post('/api/integrations/connect').set(admin.headers)
        .send({ provider: 'caldav', username: 'u', password: 'p', [field]: url });
      expect([field, r.status]).toEqual([field, 400]);
    }
  });

  it('LEGIT: a public subscription is accepted, and a delivery to an allowed receiver is signed and logged', async () => {
    const got = [];
    const receiver = http.createServer((req, res) => {
      let b = ''; req.on('data', c => { b += c; });
      req.on('end', () => { got.push({ headers: req.headers, body: b }); res.writeHead(200); res.end('ok'); });
    });
    await new Promise(r => receiver.listen(0, '127.0.0.1', r));
    try {
      const create = await ctx.request().post('/api/webhooks/outbound/subscriptions').set(admin.headers)
        .send({ name: 'ops', url: 'https://hooks.example.com/jg', events: ['*'] });
      expect([200, 201]).toContain(create.status);
      const subId = create.body.id ?? create.body.subscription?.id;
      expect(subId).toBeTruthy();

      // ATTACK via update: switching an accepted subscription to an internal URL is refused too.
      for (const url of ['https://169.254.169.254/latest/meta-data/', 'https://[::ffff:127.0.0.1]/']) {
        const u = await ctx.request().put(`/api/webhooks/outbound/subscriptions/${subId}`).set(admin.headers).send({ url });
        expect([url, u.status]).toEqual([url, 400]);
      }
      expect((await ctx.db.get('SELECT url FROM webhook_subscriptions WHERE id = ?', [subId])).url).toBe('https://hooks.example.com/jg');

      // Point it at the local receiver the way an operator-approved test would.
      await ctx.db.run('UPDATE webhook_subscriptions SET url = ? WHERE id = ?', [`http://127.0.0.1:${receiver.address().port}/hook`, subId]);
      setSsrfTestAllowList(['127.0.0.1/32']);
      const t = await ctx.request().post(`/api/webhooks/outbound/subscriptions/${subId}/test`).set(admin.headers);
      expect(t.status).toBe(200);
      expect(got).toHaveLength(1);
      expect(got[0].headers['x-jg-signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    } finally {
      setSsrfTestAllowList(null);
      await new Promise(r => receiver.close(r));
    }
  });
});
