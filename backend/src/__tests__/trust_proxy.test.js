/**
 * trust_proxy.test.js — the client IP (rate limits, guest report keys) comes
 * only from X-Forwarded-For entries appended by trusted hops (TRUST_PROXY,
 * default one hop). A client-supplied leading XFF entry is never used, and
 * "true" (trust everything) is never allowed.
 */
import express from 'express';
import request from 'supertest';
import { trustProxySetting } from '../app.js';

function echo(setting) {
  const a = express();
  a.set('trust proxy', setting);
  a.get('/ip', (req, res) => res.json({ ip: req.ip }));
  return a;
}

describe('trust proxy / client IP', () => {
  it('parses TRUST_PROXY: default 1 hop, a hop count, CIDR lists; never "trust all"', () => {
    expect(trustProxySetting(undefined)).toBe(1);
    expect(trustProxySetting('')).toBe(1);
    expect(trustProxySetting('2')).toBe(2);
    expect(trustProxySetting('true')).toBe(1);
    expect(trustProxySetting('false')).toBe(false);
    expect(trustProxySetting('100.0.0.0/8, loopback')).toEqual(['100.0.0.0/8', 'loopback']);
  });

  it('one trusted hop: a spoofed leading X-Forwarded-For entry is ignored', async () => {
    const r = await request(echo(trustProxySetting(''))).get('/ip').set('X-Forwarded-For', '6.6.6.6, 203.0.113.7');
    expect(r.body.ip).toBe('203.0.113.7');      // the entry the edge appended, not the client's claim
  });

  it('a trusted CIDR list walks back past the platform hops only', async () => {
    const r = await request(echo(trustProxySetting('loopback, 100.0.0.0/8')))
      .get('/ip').set('X-Forwarded-For', '6.6.6.6, 198.51.100.4, 100.64.0.9');
    expect(r.body.ip).toBe('198.51.100.4');
  });
});
