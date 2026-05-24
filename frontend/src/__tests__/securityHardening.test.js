/**
 * securityHardening.test.js — Tests for security-related logic
 */

describe('JWT decode safety', () => {
  const safeDecodeJWT = (token) => {
    if (!token) return null;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      return JSON.parse(atob(parts[1]));
    } catch {
      return null;
    }
  };

  it('returns null for null token', () => {
    expect(safeDecodeJWT(null)).toBeNull();
  });

  it('returns null for malformed token', () => {
    expect(safeDecodeJWT('not.a.jwt.at.all')).toBeNull();
  });

  it('returns null for token with invalid base64', () => {
    expect(safeDecodeJWT('header.!!!invalid!!!.sig')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(safeDecodeJWT('')).toBeNull();
  });

  it('parses valid JWT payload', () => {
    // Create a fake JWT: header.payload.sig (base64url encoded)
    const payload = { sub: '123', iat: 1700000000, role: 'consumer' };
    const encoded = btoa(JSON.stringify(payload));
    const fakeJWT = `header.${encoded}.sig`;
    const result = safeDecodeJWT(fakeJWT);
    expect(result?.sub).toBe('123');
    expect(result?.role).toBe('consumer');
  });
});

describe('SecureStore fallback behavior', () => {
  // The secureStorage utility falls back to AsyncStorage if SecureStore fails
  // This test verifies the fallback logic pattern

  const mockStorage = {};
  const setItemSafe = async (key, value, useSecure) => {
    if (useSecure) {
      try {
        // Simulate SecureStore (throws on simulator)
        if (key === 'force_fail') throw new Error('SecureStore unavailable');
        mockStorage['secure_' + key] = value;
      } catch {
        mockStorage[key] = value; // fallback
      }
    } else {
      mockStorage[key] = value;
    }
    return true;
  };

  it('falls back to AsyncStorage when SecureStore throws', async () => {
    await setItemSafe('force_fail', 'test_value', true);
    expect(mockStorage['force_fail']).toBe('test_value');
    expect(mockStorage['secure_force_fail']).toBeUndefined();
  });

  it('uses secure storage when available', async () => {
    await setItemSafe('normal_key', 'test_value', true);
    expect(mockStorage['secure_normal_key']).toBe('test_value');
  });
});

describe('JSON.parse safety', () => {
  const safeJsonParse = (str, fallback = null) => {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch { return fallback; }
  };

  it('returns fallback for null', () => {
    expect(safeJsonParse(null, [])).toEqual([]);
  });

  it('returns fallback for invalid JSON', () => {
    expect(safeJsonParse('not json', {})).toEqual({});
  });

  it('returns fallback for truncated JSON', () => {
    expect(safeJsonParse('{"name": "Jo', null)).toBeNull();
  });

  it('parses valid JSON correctly', () => {
    expect(safeJsonParse('{"id": 1, "name": "Test"}')).toEqual({ id: 1, name: 'Test' });
  });

  it('handles empty string safely', () => {
    expect(safeJsonParse('', 'default')).toBe('default');
  });
});
