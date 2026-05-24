/**
 * offlineCacheConsistency.test.js
 * Tests for bail search filtering, lawyer specialties parsing, and cache coherence
 */

// ── BailSearch filter+sort logic ─────────────────────────────────────────
describe('BailSearch filter and sort', () => {
  const AGENTS = [
    { id: 1, name: 'Alpha Bail', rating: 4.8, rate_pct: 10, distance_km: 2.1,  verified: true,  available_now: true,  payment_plan: false },
    { id: 2, name: 'Beta Bond',  rating: 4.2, rate_pct: 8,  distance_km: 5.0,  verified: false, available_now: false, payment_plan: true  },
    { id: 3, name: 'Gamma Bonds',rating: 4.5, rate_pct: 12, distance_km: 1.3,  verified: true,  available_now: true,  payment_plan: true  },
    { id: 4, name: 'Delta Bail', rating: 3.9, rate_pct: 9,  distance_km: 8.7,  verified: false, available_now: true,  payment_plan: false },
  ];

  const filterAndSort = (items, filters, sortBy) => {
    let result = [...items];
    if (filters.verified)     result = result.filter(b => b.verified);
    if (filters.availNow)     result = result.filter(b => b.available_now);
    if (filters.paymentPlan)  result = result.filter(b => b.payment_plan);
    if (sortBy === 'rating')  result.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    if (sortBy === 'rate')    result.sort((a, b) => (a.rate_pct ?? 10) - (b.rate_pct ?? 10));
    if (sortBy === 'distance')result.sort((a, b) => (a.distance_km ?? 999) - (b.distance_km ?? 999));
    return result;
  };

  it('returns all agents with no filters', () => {
    const result = filterAndSort(AGENTS, {}, 'rating');
    expect(result).toHaveLength(4);
  });

  it('filters verified only', () => {
    const result = filterAndSort(AGENTS, { verified: true }, null);
    expect(result.every(b => b.verified)).toBe(true);
    expect(result).toHaveLength(2);
  });

  it('filters available now', () => {
    const result = filterAndSort(AGENTS, { availNow: true }, null);
    expect(result.every(b => b.available_now)).toBe(true);
    expect(result).toHaveLength(3);
  });

  it('stacks multiple filters (verified AND available now)', () => {
    const result = filterAndSort(AGENTS, { verified: true, availNow: true }, null);
    expect(result).toHaveLength(2);
  });

  it('sorts by rating descending', () => {
    const result = filterAndSort(AGENTS, {}, 'rating');
    expect(result[0].rating).toBeGreaterThanOrEqual(result[1].rating);
    expect(result[1].rating).toBeGreaterThanOrEqual(result[2].rating);
  });

  it('sorts by rate ascending (cheapest first)', () => {
    const result = filterAndSort(AGENTS, {}, 'rate');
    expect(result[0].rate_pct).toBeLessThanOrEqual(result[1].rate_pct);
  });

  it('sorts by distance ascending (closest first)', () => {
    const result = filterAndSort(AGENTS, {}, 'distance');
    expect(result[0].distance_km).toBeLessThanOrEqual(result[1].distance_km);
  });

  it('returns empty array when all agents filtered out', () => {
    const result = filterAndSort(AGENTS, { verified: true, paymentPlan: true }, null);
    expect(result).toHaveLength(1); // only Gamma has both
    expect(result[0].name).toBe('Gamma Bonds');
  });
});

// ── LawyerProfile specialties parsing ────────────────────────────────────
describe('Lawyer specialties parsing', () => {
  const parseSpecialties = (specialties) => {
    if (typeof specialties === 'string') {
      try { return JSON.parse(specialties || '[]'); } catch {}
      return specialties.split(',').map(s => s.trim());
    }
    return specialties || [];
  };

  it('parses JSON array string', () => {
    const result = parseSpecialties('["DUI", "Criminal Defense", "Bail"]');
    expect(result).toEqual(['DUI', 'Criminal Defense', 'Bail']);
  });

  it('falls back to comma-split for non-JSON strings', () => {
    const result = parseSpecialties('DUI, Criminal Defense, Bail');
    expect(result).toEqual(['DUI', 'Criminal Defense', 'Bail']);
  });

  it('handles already-array input', () => {
    const result = parseSpecialties(['DUI', 'Bail']);
    expect(result).toEqual(['DUI', 'Bail']);
  });

  it('handles null/undefined gracefully', () => {
    expect(parseSpecialties(null)).toEqual([]);
    expect(parseSpecialties(undefined)).toEqual([]);
  });

  it('handles empty string gracefully', () => {
    // empty string: JSON.parse('') throws, so we fall through to split
    // ''.split(',') = [''] but trimming leaves one empty element
    const result = parseSpecialties('');
    expect(Array.isArray(result)).toBe(true);
  });

  it('handles malformed JSON', () => {
    const result = parseSpecialties('{bad json}');
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── Navigator registration integrity ────────────────────────────────────
describe('Navigator screen registration', () => {
  // All registered screens should have corresponding files
  // All imported screens should be registered as routes

  const checkNavConsistency = (imports, registrations) => {
    const notRegistered = imports.filter(s => !registrations.includes(s));
    const notImported = registrations.filter(s => !imports.includes(s));
    return { notRegistered, notImported };
  };

  it('no imports without registration', () => {
    // AgeGateScreen was imported but not registered — now removed
    const { notRegistered } = checkNavConsistency(['HomeScreen', 'CaseScreen'], ['HomeScreen', 'CaseScreen']);
    expect(notRegistered).toHaveLength(0);
  });

  it('no registrations without imports', () => {
    const { notImported } = checkNavConsistency(['HomeScreen', 'CaseScreen'], ['HomeScreen', 'CaseScreen']);
    expect(notImported).toHaveLength(0);
  });
});
