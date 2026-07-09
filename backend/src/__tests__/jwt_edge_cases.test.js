/**
 * jwt_edge_cases.test.js
 * Tests JWT token generation, validation, expiry, tampering, and refresh.
 * Runs without a database.
 */

import jwt from 'jsonwebtoken';

const SECRET          = 'test_jwt_secret_at_least_32_chars_long_abc';
const REFRESH_SECRET  = 'test_refresh_secret_at_least_32_chars_long';
const VALID_PAYLOAD   = { id: 'user_123', email: 'test@example.com', role: 'user' };

function signAccess(payload = VALID_PAYLOAD, options = {}) {
  return jwt.sign(payload, SECRET, { expiresIn: '15m', ...options });
}

function verifyAccess(token) {
  return jwt.verify(token, SECRET);
}

describe('JWT — valid tokens', () => {
  test('signs and verifies a valid access token', () => {
    const token = signAccess();
    const decoded = verifyAccess(token);
    expect(decoded.id).toBe(VALID_PAYLOAD.id);
    expect(decoded.email).toBe(VALID_PAYLOAD.email);
  });

  test('token contains iat and exp claims', () => {
    const token = signAccess();
    const decoded = verifyAccess(token);
    expect(decoded.iat).toBeDefined();
    expect(decoded.exp).toBeDefined();
    expect(decoded.exp).toBeGreaterThan(decoded.iat);
  });

  test('access token expires in ~15 minutes', () => {
    const token = signAccess();
    const decoded = verifyAccess(token);
    const ttl = decoded.exp - decoded.iat;
    expect(ttl).toBe(15 * 60);
  });
});

describe('JWT — expired tokens', () => {
  test('rejects an expired token', () => {
    const token = signAccess(VALID_PAYLOAD, { expiresIn: '-1s' });
    expect(() => verifyAccess(token)).toThrow(jwt.TokenExpiredError);
  });

  test('expired token error name is TokenExpiredError', () => {
    const token = signAccess(VALID_PAYLOAD, { expiresIn: '-1s' });
    try {
      verifyAccess(token);
    } catch (e) {
      expect(e.name).toBe('TokenExpiredError');
      expect(e.expiredAt).toBeDefined();
    }
  });
});

describe('JWT — tampered tokens', () => {
  test('rejects token with modified payload', () => {
    const token = signAccess();
    const [header, payload, sig] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
    decoded.role = 'admin';  // escalate privilege
    const tampered = header + '.' +
      Buffer.from(JSON.stringify(decoded)).toString('base64') + '.' + sig;
    expect(() => verifyAccess(tampered)).toThrow(jwt.JsonWebTokenError);
  });

  test('rejects token with wrong signature', () => {
    const token = signAccess();
    const parts = token.split('.');
    parts[2] = 'invalidsignature';
    expect(() => verifyAccess(parts.join('.'))).toThrow(jwt.JsonWebTokenError);
  });

  test('rejects token signed with different secret', () => {
    const token = jwt.sign(VALID_PAYLOAD, 'wrong_secret_here_abc_123_xyz');
    expect(() => verifyAccess(token)).toThrow(jwt.JsonWebTokenError);
  });

  test('rejects token with none algorithm', () => {
    const payload = { ...VALID_PAYLOAD, iat: Math.floor(Date.now()/1000) };
    const token = Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64') +
      '.' + Buffer.from(JSON.stringify(payload)).toString('base64') + '.';
    expect(() => verifyAccess(token)).toThrow();
  });
});

describe('JWT — malformed tokens', () => {
  const malformed = ['', 'not.a.token', 'only.two', null, undefined,
                     'a'.repeat(1000), '..', 'Bearer token', 123];

  test.each(malformed)('rejects malformed token: %p', (token) => {
    expect(() => verifyAccess(token)).toThrow();
  });
});

describe('JWT — refresh token', () => {
  test('refresh token can be signed and verified independently', () => {
    const refresh = jwt.sign({ id: VALID_PAYLOAD.id }, REFRESH_SECRET, { expiresIn: '7d' });
    const decoded = jwt.verify(refresh, REFRESH_SECRET);
    expect(decoded.id).toBe(VALID_PAYLOAD.id);
    const ttl = decoded.exp - decoded.iat;
    expect(ttl).toBe(7 * 24 * 60 * 60);
  });

  test('refresh token does not verify with access secret', () => {
    const refresh = jwt.sign({ id: VALID_PAYLOAD.id }, REFRESH_SECRET, { expiresIn: '7d' });
    expect(() => jwt.verify(refresh, SECRET)).toThrow();
  });

  test('access token does not verify with refresh secret', () => {
    const access = signAccess();
    expect(() => jwt.verify(access, REFRESH_SECRET)).toThrow();
  });
});
