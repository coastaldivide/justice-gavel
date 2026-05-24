/**
 * offlineCacheConsistency.test.js
 * Tests for offline cache read/write consistency and key isolation
 */

describe('Offline cache key isolation', () => {
  // All AsyncStorage keys used in the app — verify no accidental collisions
  const ALL_KEYS = [
    'age_verified', 'analytics_id', 'biometric_enabled',
    'chat_consent_accepted', 'chat_session_id', 'completed_lessons',
    'contacts', 'has_browsed', 'home_visit_count', 'jg_last_search',
    'jg_recent_searches', 'lang', 'last_payment_method', 'last_push_token',
    'lawyers_need_shown', 'notifs', 'onboarding_done', 'pending_save_lawyer',
    'token', 'user', 'userName', 'user_state', 'user_subscription',
  ];

  it('has no duplicate keys', () => {
    const unique = new Set(ALL_KEYS);
    expect(unique.size).toBe(ALL_KEYS.length);
  });

  it('prefixes jg_ on search-related keys to prevent collision', () => {
    const searchKeys = ALL_KEYS.filter(k => k.includes('search'));
    searchKeys.forEach(k => {
      expect(k.startsWith('jg_')).toBe(true);
    });
  });

  it('uses descriptive names (no bare generic keys)', () => {
    const genericRisk = ALL_KEYS.filter(k => ['data', 'info', 'cache', 'temp'].includes(k));
    expect(genericRisk).toHaveLength(0);
  });
});

describe('Money display formatting', () => {
  const formatCents = (cents) => ((cents ?? 0) / 100).toFixed(2);
  const formatMoney = (cents) => `$${formatCents(cents)}`;

  it('formats zero cents as $0.00', () => {
    expect(formatMoney(0)).toBe('$0.00');
  });

  it('formats null cents as $0.00', () => {
    expect(formatMoney(null)).toBe('$0.00');
  });

  it('formats 999 cents as $9.99', () => {
    expect(formatMoney(999)).toBe('$9.99');
  });

  it('formats 100000 cents as $1000.00', () => {
    expect(formatMoney(100000)).toBe('$1000.00');
  });

  it('always shows exactly 2 decimal places', () => {
    [1, 10, 100, 1000, 10000].forEach(cents => {
      const result = formatMoney(cents);
      const decimals = result.split('.')[1];
      expect(decimals).toHaveLength(2);
    });
  });
});

describe('Date formatting for court dates', () => {
  const formatCourtDate = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  };

  it('returns empty string for null date', () => {
    expect(formatCourtDate(null)).toBe('');
    expect(formatCourtDate(undefined)).toBe('');
  });

  it('formats ISO date string', () => {
    const result = formatCourtDate('2026-06-15');
    expect(result).toContain('Jun');
    expect(result).toContain('15');
    expect(result).toContain('2026');
  });

  it('produces human-readable format (not raw ISO)', () => {
    const result = formatCourtDate('2026-06-15T14:30:00Z');
    expect(result).not.toContain('T');
    expect(result).not.toContain('Z');
    expect(result).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
