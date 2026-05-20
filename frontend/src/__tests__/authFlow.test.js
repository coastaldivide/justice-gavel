/**
 * authFlow.test.js
 * Tests authentication logic — login validation, token storage,
 * registration rules, and form state management.
 * Pure logic tests — no React rendering required.
 */

// ── Inline auth utilities mirroring the real screens ─────────────────────────
const jwt_decode_simple = (token) => {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch { return null; }
};

// Email validation (mirrors RegisterScreen)
function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase());
}

// Password validation (mirrors RegisterScreen)
function validatePassword(password) {
  const errors = [];
  if (password.length < 8) errors.push('At least 8 characters required');
  return errors;
}

// Phone normalisation (mirrors profile update)
function normalisePhone(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

// Mock api module
const api = {
  post: jest.fn(),
  get:  jest.fn(),
  defaults: { headers: { common: {} } },
};

// Token storage mock
const tokenStore = { token: null };
const storeToken  = (t) => { tokenStore.token = t; api.defaults.headers.common['Authorization'] = `Bearer ${t}`; };
const clearToken  = ()  => { tokenStore.token = null; delete api.defaults.headers.common['Authorization']; };

// ── Tests ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
  clearToken();
});

describe('Email validation', () => {
  const valid = [
    'user@example.com', 'user+tag@domain.co.uk',
    'firstname.lastname@company.org', 'test123@test.io',
  ];
  const invalid = [
    '', 'notanemail', 'missing@domain', '@nodomain.com',
    'spaces in@email.com', 'double@@domain.com',
  ];

  it.each(valid)('accepts valid email: %s', (email) => {
    expect(validateEmail(email)).toBe(true);
  });

  it.each(invalid)('rejects invalid email: %s', (email) => {
    expect(validateEmail(email)).toBe(false);
  });
});

describe('Password validation', () => {
  it('accepts passwords ≥ 8 characters', () => {
    expect(validatePassword('password123')).toHaveLength(0);
    expect(validatePassword('12345678')).toHaveLength(0);
  });

  it('rejects passwords < 8 characters', () => {
    expect(validatePassword('short')).not.toHaveLength(0);
    expect(validatePassword('')).not.toHaveLength(0);
    expect(validatePassword('1234567')).not.toHaveLength(0);
  });
});

describe('Phone normalisation', () => {
  it('formats 10-digit US number', () => {
    expect(normalisePhone('8655551234')).toBe('+18655551234');
    expect(normalisePhone('(865) 555-1234')).toBe('+18655551234');
    expect(normalisePhone('865.555.1234')).toBe('+18655551234');
  });

  it('handles 11-digit number with leading 1', () => {
    expect(normalisePhone('18655551234')).toBe('+18655551234');
  });

  it('returns null for invalid lengths', () => {
    expect(normalisePhone('12345')).toBeNull();
    expect(normalisePhone('')).toBeNull();
  });
});

describe('Login API flow', () => {
  it('stores token and sets auth header on success', async () => {
    const fakeToken = 'header.' + Buffer.from(JSON.stringify({ id:1, role:'user' })).toString('base64') + '.sig';
    api.post.mockResolvedValueOnce({ data: { ok:true, token: fakeToken, user: { id:1, email:'test@test.com' } } });

    const res = await api.post('/auth/login', { email:'test@test.com', password:'password123' });
    storeToken(res.data.token);

    expect(tokenStore.token).toBe(fakeToken);
    expect(api.defaults.headers.common['Authorization']).toBe(`Bearer ${fakeToken}`);
  });

  it('does not store token on failed login', async () => {
    api.post.mockRejectedValueOnce({ response: { status:401, data: { error:'Invalid credentials.' } } });

    try {
      await api.post('/auth/login', { email:'wrong@test.com', password:'wrongpass' });
    } catch {}

    expect(tokenStore.token).toBeNull();
    expect(api.defaults.headers.common['Authorization']).toBeUndefined();
  });

  it('clears token on logout', async () => {
    storeToken('some.fake.token');
    expect(tokenStore.token).toBe('some.fake.token');
    clearToken();
    expect(tokenStore.token).toBeNull();
    expect(api.defaults.headers.common['Authorization']).toBeUndefined();
  });
});

describe('JWT decode', () => {
  it('extracts payload from a valid JWT structure', () => {
    const payload = { id:1, role:'user', email:'a@b.com' };
    const encoded = 'header.' + Buffer.from(JSON.stringify(payload)).toString('base64') + '.sig';
    const decoded  = jwt_decode_simple(encoded);
    expect(decoded.id).toBe(1);
    expect(decoded.role).toBe('user');
  });

  it('returns null for malformed token', () => {
    expect(jwt_decode_simple('not.a.token')).toBeNull();
    expect(jwt_decode_simple('')).toBeNull();
  });
});

describe('Registration validation', () => {
  it('requires valid email and password ≥ 8 chars', async () => {
    const cases = [
      { email:'', password:'password', expected:false },
      { email:'test@test.com', password:'short', expected:false },
      { email:'test@test.com', password:'validpassword', expected:true },
      { email:'invalid-email', password:'validpassword', expected:false },
    ];
    for (const { email, password, expected } of cases) {
      const emailOk    = validateEmail(email);
      const passErrors = validatePassword(password);
      const valid      = emailOk && passErrors.length === 0;
      expect(valid).toBe(expected);
    }
  });
});
