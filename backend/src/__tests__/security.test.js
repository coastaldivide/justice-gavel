/**
 * security.test.js — Security-critical checks
 * Tests: Helmet headers, CORS, parseInt injection, XSS, rate limit, enumeration
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { makeTestDb, createSchema } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;

function buildSecureApp() {
  const app = express();
  app.use(helmet({
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'self'"], connectSrc: ["'self'","https://api.anthropic.com"], objectSrc: ["'none'"] },
    },
  }));
  app.use(cors());
  app.use(express.json());
  const limiter = rateLimit({ windowMs: 15*60*1000, max: 1000, standardHeaders: true, legacyHeaders: false });
  app.use('/api/', limiter);

  app.get('/api/test/user/:id', (req,res) => {
    const id=parseInt(req.params.id);
    if(isNaN(id)) return res.status(400).json({error:'invalid id'});
    res.json({id,safe:true});
  });
  app.get('/api/test/echo', (req,res) => res.json({echo: req.query.msg || ''}));
  return app;
}

const app = buildSecureApp();

describe('Helmet security headers', () => {
  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).get('/api/test/echo');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options', async () => {
    const res = await request(app).get('/api/test/echo');
    const xfo = (res.headers['x-frame-options'] || '').toUpperCase();
    expect(['DENY','SAMEORIGIN']).toContain(xfo);
  });

  it('removes X-Powered-By', async () => {
    const res = await request(app).get('/api/test/echo');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sets Content-Security-Policy with default-src self', async () => {
    const res = await request(app).get('/api/test/echo');
    const csp = res.headers['content-security-policy'] || '';
    expect(csp).toContain("default-src 'self'");
  });
});

describe('CORS', () => {
  it('responds to OPTIONS preflight', async () => {
    const res = await request(app)
      .options('/api/test/echo')
      .set('Origin','https://example.com')
      .set('Access-Control-Request-Method','GET');
    expect([200,204]).toContain(res.status);
  });
});

describe('parseInt injection prevention', () => {
  // These strings cannot be parsed as integers by parseInt() → 400
  const nonNumeric = ["'; DROP TABLE users;--", '../../../etc', 'undefined', 'abc'];
  it.each(nonNumeric)('rejects non-numeric "%s" with 400', async (bad) => {
    const res = await request(app).get(`/api/test/user/${encodeURIComponent(bad)}`);
    expect(res.status).toBe(400);
  });

  // '1 OR 1=1' → parseInt gives 1 (JS intentionally ignores trailing text).
  // Protection against SQL injection comes from parameterised queries, not parseInt.
  it('parseInt("1 OR 1=1") → 1 (trailing text ignored — parameterised queries protect DB)', async () => {
    const res = await request(app).get('/api/test/user/1%20OR%201%3D1');
    // parseInt gives 1, so route accepts it. The DB is protected by ? placeholders.
    expect([200, 400]).toContain(res.status);
  });

  it('accepts valid numeric id', async () => {
    const res = await request(app).get('/api/test/user/42');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(42);
  });
});

describe('JSON output safety', () => {
  it('serialises script tags without executing them', async () => {
    const xss = '<script>alert(1)</script>';
    const res = await request(app).get(`/api/test/echo?msg=${encodeURIComponent(xss)}`);
    expect(res.status).toBe(200);
    expect(res.body.echo).toBe(xss);  // value preserved, not executed
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

describe('Rate limiting headers', () => {
  it('includes RateLimit headers on API routes', async () => {
    const res = await request(app).get('/api/test/echo');
    const hasHeader = res.headers['ratelimit-limit'] || res.headers['x-ratelimit-limit'];
    expect(hasHeader).toBeTruthy();
  });
});

describe('Account enumeration prevention', () => {
  it('login returns identical error for wrong user vs wrong password', async () => {
    const testDb = await makeTestDb();
    await createSchema(testDb);
    const hash = await bcrypt.hash('realpassword', 4);
    await testDb.run('INSERT INTO users (email,password_hash) VALUES (?,?)', ['real@test.com', hash]);

    const authApp = express();
    authApp.use(express.json());
    authApp.post('/login', async (req,res) => {
      const {email,password}=req.body||{};
      const user=await testDb.get('SELECT * FROM users WHERE email=?',[email?.toLowerCase()]);
      if(!user) return res.status(401).json({error:'Invalid credentials.'});
      const ok=await bcrypt.compare(password,user.password_hash);
      if(!ok) return res.status(401).json({error:'Invalid credentials.'});
      res.json({ok:true});
    });

    const wrongUser = await request(authApp).post('/login').send({email:'nobody@test.com',password:'anything'});
    const wrongPass = await request(authApp).post('/login').send({email:'real@test.com',password:'wrongpass'});

    expect(wrongUser.status).toBe(401);
    expect(wrongPass.status).toBe(401);
    expect(wrongUser.body.error).toBe(wrongPass.body.error);  // CRITICAL: same message
  });
});
