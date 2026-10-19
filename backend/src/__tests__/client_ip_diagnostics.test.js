/**
 * client_ip_diagnostics.test.js — the report behind
 * GET /api/admin/diagnostics/client-ip (utils/clientIp.js), which the owner
 * uses to set TRUST_PROXY after a deploy (RUNBOOK "Client IP / TRUST_PROXY").
 *
 * The report must (a) show exactly what Express derived (req.ip / req.ips) and
 * (b) predict correctly which IP each hop count would pick — checked here by
 * actually running Express with each hop count. Auth (live admin role +
 * X-Admin-Key) is covered on real Postgres in
 * security/client_ip_diagnostics.int.test.js.
 */
import express from 'express';
import request from 'supertest';
import { clientIpReport } from '../utils/clientIp.js';
import { trustProxySetting } from '../app.js';

const appWith = (trust) => {
  const app = express();
  app.set('trust proxy', trust);
  app.get('/r', (req, res) => res.json(clientIpReport(req)));
  return app;
};
const XFF = '198.51.100.7, 203.0.113.20, 10.1.2.3';   // client, edge hop, internal hop

describe('clientIpReport', () => {
  test('shape: ip, ips, raw XFF, socket peer, trust setting, candidates', async () => {
    const r = await request(appWith(1)).get('/r').set('X-Forwarded-For', XFF);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['candidates', 'instance', 'ip', 'ips', 'other_headers', 'platform',
      'socket_remote_address', 'trust_proxy', 'x_forwarded_for']);
    expect(r.body.x_forwarded_for).toBe(XFF);
    expect(r.body.socket_remote_address).toMatch(/127\.0\.0\.1/);
    expect(r.body.trust_proxy.effective).toBe(1);
    expect(r.body.ip).toBe('10.1.2.3');                         // one hop trusted → rightmost XFF entry
    expect(r.body.candidates.map(c => c.trust_proxy)).toEqual([0, 1, 2, 3]);
    expect(r.body.candidates.slice(1).map(c => c.ip)).toEqual(['10.1.2.3', '203.0.113.20', '198.51.100.7']);
    expect(r.body.other_headers).toEqual({ 'x-real-ip': null, 'true-client-ip': null, 'cf-connecting-ip': null });
  });

  test.each([0, 1, 2, 3])('candidate for trust proxy = %i is the IP Express actually picks', async (n) => {
    const predicted = (await request(appWith(1)).get('/r').set('X-Forwarded-For', XFF)).body.candidates[n].ip;
    const actual = (await request(appWith(n)).get('/r').set('X-Forwarded-For', XFF)).body;
    expect(actual.ip).toBe(predicted);
    expect(actual.trust_proxy.effective).toBe(n);
  });

  test('3 hops picks the client; a client-forged XFF entry is ignored at the right setting', async () => {
    const real = await request(appWith(3)).get('/r').set('X-Forwarded-For', XFF);
    expect(real.body.ip).toBe('198.51.100.7');
    const forged = await request(appWith(3)).get('/r').set('X-Forwarded-For', `6.6.6.6, ${XFF}`);
    expect(forged.body.ip).toBe('198.51.100.7');
    expect(forged.body.ips[0]).toBe('198.51.100.7');
  });

  test('no proxy headers: everything falls back to the socket peer', async () => {
    const r = await request(appWith(trustProxySetting(''))).get('/r');
    expect(r.body.x_forwarded_for).toBeNull();
    expect(r.body.ips).toEqual([]);
    expect(r.body.candidates).toHaveLength(1);
    expect(r.body.ip).toBe(r.body.socket_remote_address);
  });

  test('a CIDR-list setting is reported as given; TRUST_PROXY=true never trusts everything', async () => {
    const r = await request(appWith(trustProxySetting('10.0.0.0/8,loopback'))).get('/r').set('X-Forwarded-For', XFF);
    expect(r.body.trust_proxy.effective).toEqual(['10.0.0.0/8', 'loopback']);
    expect(r.body.ip).toBe('203.0.113.20');                     // loopback + 10/8 trusted, next one is the edge
    expect(trustProxySetting('true')).toBe(1);
  });
});
