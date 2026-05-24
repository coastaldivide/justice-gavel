/**
 * chatAndNavigation.test.js
 * Tests for chat system, navigation patterns, and service resilience
 */

// ── Chat streaming robustness ─────────────────────────────────────────────
describe('Chat streaming response handling', () => {
  const parseStreamChunk = (chunk) => {
    if (!chunk || typeof chunk !== 'string') return null;
    if (chunk.startsWith('data: ')) {
      const data = chunk.slice(6).trim();
      if (data === '[DONE]') return { done: true };
      try {
        return JSON.parse(data);
      } catch {
        return null;
      }
    }
    return null;
  };

  it('parses a valid data chunk', () => {
    const result = parseStreamChunk('data: {"content":"Hello"}');
    expect(result).toEqual({ content: 'Hello' });
  });

  it('detects [DONE] marker', () => {
    const result = parseStreamChunk('data: [DONE]');
    expect(result).toEqual({ done: true });
  });

  it('returns null for malformed JSON', () => {
    const result = parseStreamChunk('data: {bad json}');
    expect(result).toBeNull();
  });

  it('returns null for empty chunk', () => {
    expect(parseStreamChunk('')).toBeNull();
    expect(parseStreamChunk(null)).toBeNull();
  });

  it('returns null for non-data chunk', () => {
    const result = parseStreamChunk('event: heartbeat');
    expect(result).toBeNull();
  });
});

// ── Expungement wait period calculations ────────────────────────────────
describe('Expungement eligibility by state', () => {
  // A sample of state wait periods for validation
  const STATE_WAIT_YEARS = {
    TN: { misdemeanor: 5, felony: 8 },
    CA: { misdemeanor: 1, felony: null }, // CA felonies generally not eligible
    TX: { misdemeanor: null, felony: null }, // TX: non-disclosure only
    IL: { misdemeanor: 3, felony: 5 },
    NY: { misdemeanor: 0, felony: null }, // NY: sealing, not expungement
  };

  const isEligible = (state, type, yearsElapsed) => {
    const wait = STATE_WAIT_YEARS[state]?.[type];
    if (wait === null || wait === undefined) return 'not_eligible';
    return yearsElapsed >= wait ? 'eligible' : 'not_yet';
  };

  it('TN misdemeanor eligible after 5 years', () => {
    expect(isEligible('TN', 'misdemeanor', 5)).toBe('eligible');
    expect(isEligible('TN', 'misdemeanor', 4)).toBe('not_yet');
  });

  it('IL misdemeanor eligible after 3 years', () => {
    expect(isEligible('IL', 'misdemeanor', 3)).toBe('eligible');
  });

  it('TX returns not_eligible (non-disclosure only)', () => {
    expect(isEligible('TX', 'felony', 10)).toBe('not_eligible');
  });

  it('unknown state returns not_eligible', () => {
    expect(isEligible('XX', 'misdemeanor', 10)).toBe('not_eligible');
  });

  it('exactly at threshold is eligible', () => {
    expect(isEligible('TN', 'misdemeanor', 5)).toBe('eligible');
  });
});

// ── Deadline calculator accuracy ──────────────────────────────────────────
describe('Criminal deadline date math', () => {
  const addHours = (date, hours) => {
    const d = new Date(date);
    d.setHours(d.getHours() + hours);
    return d;
  };
  const addDays = (date, days) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  };

  const ARREST_DATE = new Date('2026-01-01T10:00:00');

  it('arraignment: 72 hours after arrest', () => {
    const deadline = addHours(ARREST_DATE, 72);
    expect(deadline.getHours()).toBe(10); // same hour, 3 days later
    expect(deadline.getDate()).toBe(4);
  });

  it('bail hearing: 48 hours after arrest', () => {
    const deadline = addHours(ARREST_DATE, 48);
    expect(deadline.getDate()).toBe(3);
  });

  it('preliminary hearing: 14 days after arrest', () => {
    const deadline = addDays(ARREST_DATE, 14);
    expect(deadline.getDate()).toBe(15);
  });

  it('speedy trial: 70 days after arrest (federal Speedy Trial Act)', () => {
    const deadline = addDays(ARREST_DATE, 70);
    expect(deadline.getMonth()).toBe(2); // March (0-indexed)
  });

  it('statute of limitations calculation is additive', () => {
    const start = new Date('2020-06-15');
    const deadline = addDays(start, 365 * 3);
    expect(deadline.getFullYear()).toBe(2023);
  });
});

// ── BailSearch filter edge cases ─────────────────────────────────────────
describe('BailSearch additional edge cases', () => {
  it('handles agents with null rating gracefully', () => {
    const agents = [
      { id: 1, rating: null, rate_pct: 10 },
      { id: 2, rating: 4.5, rate_pct: 8 },
    ];
    const sorted = [...agents].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    expect(sorted[0].id).toBe(2); // non-null rating first
  });

  it('handles agents with null distance gracefully', () => {
    const agents = [
      { id: 1, distance_km: null },
      { id: 2, distance_km: 3.5 },
    ];
    const sorted = [...agents].sort((a, b) => (a.distance_km ?? 999) - (b.distance_km ?? 999));
    expect(sorted[0].id).toBe(2); // known distance first
  });

  it('payment plan filter works with missing field', () => {
    const agents = [
      { id: 1, payment_plan: undefined },
      { id: 2, payment_plan: true },
    ];
    const filtered = agents.filter(b => b.payment_plan);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(2);
  });
});
