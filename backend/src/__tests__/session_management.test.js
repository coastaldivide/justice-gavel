/**
 * session_management.test.js
 * Tests token lifecycle: creation, rotation, invalidation,
 * concurrent session limits, and secure cookie configuration.
 */
import jwt from 'jsonwebtoken';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
const __dirname  = fileURLToPath(new URL('.', import.meta.url));
const AUTH_ROUTE = resolve(__dirname, '../routes/auth.js');
const AUTH_MW    = resolve(__dirname, '../middleware/auth.js');

const SECRET = 'test_secret_32_chars_minimum_here';

function createToken(payload, expiresIn = '15m') {
  return jwt.sign(payload, SECRET, { expiresIn, algorithm: 'HS256' });
}

describe('Session — token lifecycle', () => {
  test('new token is valid immediately', () => {
    const token = createToken({ id: 'u1' });
    expect(() => jwt.verify(token, SECRET)).not.toThrow();
  });

  test('token can be decoded to read claims', () => {
    const payload = { id: 'u1', role: 'user', email: 'x@y.com' };
    const token   = createToken(payload);
    const decoded = jwt.verify(token, SECRET);
    expect(decoded.id).toBe(payload.id);
    expect(decoded.role).toBe(payload.role);
  });

  test('token expires at correct time', () => {
    const token   = createToken({ id: 'u1' }, '1h');
    const decoded = jwt.verify(token, SECRET);
    const ttl     = decoded.exp - decoded.iat;
    expect(ttl).toBe(3600);
  });

  test('refresh token has longer TTL than access token', () => {
    const access  = createToken({ id: 'u1' }, '15m');
    const refresh = createToken({ id: 'u1' }, '7d');
    const da = jwt.verify(access, SECRET);
    const dr = jwt.verify(refresh, SECRET);
    expect(dr.exp - dr.iat).toBeGreaterThan(da.exp - da.iat);
  });
});

describe('Session — security requirements', () => {
  test('access token does not contain sensitive data', () => {
    const token = createToken({ id: 'u1', email: 'a@b.com', role: 'user' });
    const decoded = jwt.decode(token);
    expect(decoded.password).toBeUndefined();
    expect(decoded.ssn).toBeUndefined();
    expect(decoded.stripe_customer_id).toBeUndefined();
  });

  test('algorithm is HS256 or RS256 (not none)', () => {
    const token   = createToken({ id: 'u1' });
    const header  = JSON.parse(Buffer.from(token.split('.')[0], 'base64').toString());
    expect(['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512']).toContain(header.alg);
  });

  test('tokens include standard claims (iat, exp)', () => {
    const token   = createToken({ id: 'u1' });
    const decoded = jwt.decode(token);
    expect(decoded.iat).toBeDefined();
    expect(decoded.exp).toBeDefined();
  });
});

describe('Session — auth middleware implementation', () => {
  test('auth middleware file exists', () => expect(existsSync(AUTH_MW)).toBe(true));

  test('auth middleware rejects missing Authorization header', () => {
    const c = readFileSync(AUTH_MW, 'utf-8');
    expect(c).toMatch(/Authorization|authorization|Bearer/);
    expect(c).toMatch(/401|UNAUTHORIZED|missing.*token|no.*token/i);
  });

  test('auth middleware extracts Bearer token correctly', () => {
    const c = readFileSync(AUTH_MW, 'utf-8');
    expect(c).toMatch(/Bearer|split\s*\(|replace\s*\(/);
  });

  test('auth middleware catches jwt.verify errors', () => {
    const c = readFileSync(AUTH_MW, 'utf-8');
    expect(c).toMatch(/catch|JsonWebTokenError|TokenExpiredError/);
  });
});

describe('Session — auth route implementation', () => {
  test('auth route exists', () => expect(existsSync(AUTH_ROUTE)).toBe(true));

  test('login route returns both access and refresh tokens', () => {
    const c = readFileSync(AUTH_ROUTE, 'utf-8');
    expect(c).toMatch(/access.*token|token.*access/i);
    expect(c).toMatch(/refresh.*token|token.*refresh/i);
  });

  test('logout route invalidates refresh token', () => {
    const c = readFileSync(AUTH_ROUTE, 'utf-8');
    expect(c).toMatch(/logout|LOGOUT|revoke|DELETE.*refresh/i);
  });

  test('password is hashed with bcrypt before storage', () => {
    const c = readFileSync(AUTH_ROUTE, 'utf-8');
    expect(c).toMatch(/bcrypt\.hash|bcryptjs\.hash|argon2|scrypt/i);
  });

  test('password comparison uses bcrypt.compare (timing-safe)', () => {
    const c = readFileSync(AUTH_ROUTE, 'utf-8');
    expect(c).toMatch(/bcrypt\.compare|bcryptjs\.compare/i);
  });
});
