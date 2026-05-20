/**
 * apiService.test.js
 * Tests the API service layer — request/response handling, error
 * normalisation, timeout behaviour, and auth header injection.
 */

// ── Minimal api service mirroring src/services/api.ts ─────────────────────────

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data   = data;
  }
}

// Normalise axios-style error to user-friendly message
function normaliseError(err) {
  if (!err.response) {
    return err.code === 'ECONNABORTED'
      ? 'Request timed out. Check your connection.'
      : 'Network error. Please check your connection.';
  }
  const { status, data } = err.response;
  const serverMsg = data?.error || data?.message;
  switch (status) {
    case 400: return serverMsg || 'Invalid request.';
    case 401: return 'Session expired. Please log in again.';
    case 403: return 'You do not have permission to do that.';
    case 404: return serverMsg || 'Not found.';
    case 429: return 'Too many requests. Please wait a moment.';
    case 500: return serverMsg || 'Server error. Please try again.';
    default:  return serverMsg || `Error ${status}. Please try again.`;
  }
}

// Token injection helper
function buildHeaders(token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// Subscription tier check
function hasFeature(subscription, feature) {
  const tiers = {
    starter:  ['ai_guide','cases','emergency'],
    pro:      ['ai_guide','cases','emergency','arrest_monitor','messages'],
    intel:    ['ai_guide','cases','emergency','arrest_monitor','messages','research','intel'],
    research: ['ai_guide','cases','emergency','arrest_monitor','messages','research','intel','unlimited_research'],
  };
  const allowed = tiers[subscription] ?? tiers.starter;
  return allowed.includes(feature);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('Error normalisation', () => {
  it('handles network error (no response)', () => {
    const err = { response: null, code: '' };
    expect(normaliseError(err)).toMatch(/network error/i);
  });

  it('handles timeout error', () => {
    const err = { response: null, code: 'ECONNABORTED' };
    expect(normaliseError(err)).toMatch(/timed out/i);
  });

  it('maps 401 to session expired message', () => {
    const err = { response: { status:401, data:{} } };
    expect(normaliseError(err)).toMatch(/session expired/i);
  });

  it('maps 403 to permission denied message', () => {
    const err = { response: { status:403, data:{} } };
    expect(normaliseError(err)).toMatch(/permission/i);
  });

  it('maps 429 to rate limit message', () => {
    const err = { response: { status:429, data:{} } };
    expect(normaliseError(err)).toMatch(/too many/i);
  });

  it('uses server error message when provided', () => {
    const err = { response: { status:400, data:{ error:'Email already exists.' } } };
    expect(normaliseError(err)).toBe('Email already exists.');
  });

  it('maps 500 to generic server error', () => {
    const err = { response: { status:500, data:{} } };
    expect(normaliseError(err)).toMatch(/server error/i);
  });
});

describe('Auth header injection', () => {
  it('includes Authorization header when token provided', () => {
    const headers = buildHeaders('my.jwt.token');
    expect(headers['Authorization']).toBe('Bearer my.jwt.token');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('omits Authorization header when no token', () => {
    const headers = buildHeaders(null);
    expect(headers['Authorization']).toBeUndefined();
  });

  it('omits Authorization header for empty string token', () => {
    const headers = buildHeaders('');
    expect(headers['Authorization']).toBeUndefined();
  });
});

describe('Subscription feature gating', () => {
  it('starter plan has basic features', () => {
    expect(hasFeature('starter', 'ai_guide')).toBe(true);
    expect(hasFeature('starter', 'cases')).toBe(true);
    expect(hasFeature('starter', 'emergency')).toBe(true);
    expect(hasFeature('starter', 'research')).toBe(false);
    expect(hasFeature('starter', 'arrest_monitor')).toBe(false);
  });

  it('pro plan includes arrest monitoring', () => {
    expect(hasFeature('pro', 'arrest_monitor')).toBe(true);
    expect(hasFeature('pro', 'messages')).toBe(true);
    expect(hasFeature('pro', 'intel')).toBe(false);
  });

  it('intel plan includes research', () => {
    expect(hasFeature('intel', 'research')).toBe(true);
    expect(hasFeature('intel', 'intel')).toBe(true);
    expect(hasFeature('intel', 'unlimited_research')).toBe(false);
  });

  it('research plan has all features', () => {
    expect(hasFeature('research', 'unlimited_research')).toBe(true);
    expect(hasFeature('research', 'intel')).toBe(true);
  });

  it('unknown subscription falls back to starter', () => {
    expect(hasFeature('unknown_tier', 'ai_guide')).toBe(true);
    expect(hasFeature('unknown_tier', 'research')).toBe(false);
  });
});
