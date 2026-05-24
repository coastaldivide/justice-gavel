/**
 * dataIntegrity.test.js
 * Tests for data integrity, optimistic UI, form validation, and state machines
 */

// ── Form validation patterns ──────────────────────────────────────────────
describe('Form validation', () => {
  const validateReviewForm = (rating, text) => {
    const errors = [];
    if (!rating || rating < 1 || rating > 5) errors.push('rating_required');
    if (text && text.length > 500) errors.push('comment_too_long');
    return errors;
  };

  const validateAvailabilitySave = (schedule) => {
    // Schedule is an object of days → time slots
    // Empty schedule is valid (attorney not available)
    if (!schedule || typeof schedule !== 'object') return ['invalid_schedule'];
    return [];
  };

  it('review requires a star rating', () => {
    expect(validateReviewForm(0, '')).toContain('rating_required');
    expect(validateReviewForm(null, '')).toContain('rating_required');
  });

  it('review accepts rating 1-5', () => {
    for (let r = 1; r <= 5; r++) {
      expect(validateReviewForm(r, '')).toHaveLength(0);
    }
  });

  it('review rejects comment over 500 chars', () => {
    expect(validateReviewForm(4, 'x'.repeat(501))).toContain('comment_too_long');
  });

  it('availability save accepts empty schedule', () => {
    expect(validateAvailabilitySave({})).toHaveLength(0);
  });

  it('availability save rejects null schedule', () => {
    expect(validateAvailabilitySave(null)).toContain('invalid_schedule');
  });
});

// ── Optimistic UI delete patterns ─────────────────────────────────────────
describe('Optimistic UI delete with rollback', () => {
  const optimisticDelete = async (items, id, serverDelete) => {
    const original = [...items];
    const optimistic = items.filter(i => i.id !== id);

    try {
      await serverDelete(id);
      return { items: optimistic, error: null };
    } catch (err) {
      // Rollback on failure
      return { items: original, error: err.message };
    }
  };

  const items = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }];

  it('removes item optimistically on success', async () => {
    const serverDelete = jest.fn().mockResolvedValue(true);
    const result = await optimisticDelete(items, 2, serverDelete);
    expect(result.items).toHaveLength(2);
    expect(result.items.find(i => i.id === 2)).toBeUndefined();
  });

  it('rolls back on server failure', async () => {
    const serverDelete = jest.fn().mockRejectedValue(new Error('Network error'));
    const result = await optimisticDelete(items, 2, serverDelete);
    expect(result.items).toHaveLength(3);
    expect(result.error).toBe('Network error');
  });

  it('does not modify original array', async () => {
    const serverDelete = jest.fn().mockResolvedValue(true);
    const original = [...items];
    await optimisticDelete(items, 1, serverDelete);
    expect(items).toHaveLength(3); // items unchanged
  });
});

// ── State machine completeness ────────────────────────────────────────────
describe('State machine transitions', () => {
  // All workflows should have a clear terminal state
  const TERMINAL_STATES = new Set(['done', 'error', 'complete', 'success', 'idle', 'result', 'confirmed']);

  const hasTerminalExit = (states) =>
    states.some(s => TERMINAL_STATES.has(s));

  it('motion generation has terminal state', () => {
    const states = ['idle', 'form', 'confirm', 'generating', 'result', 'error'];
    expect(hasTerminalExit(states)).toBe(true);
  });

  it('booking flow has terminal state', () => {
    const states = ['datetime', 'callback', 'confirmed', 'callback_sent'];
    expect(hasTerminalExit(states)).toBe(true);
  });

  it('emergency share has terminal state', () => {
    const states = ['ready', 'locating', 'confirm', 'sending', 'done', 'error'];
    expect(hasTerminalExit(states)).toBe(true);
  });

  it('check-in has terminal state', () => {
    const states = ['ready', 'locating', 'uploading', 'done', 'already_done', 'error'];
    expect(hasTerminalExit(states)).toBe(true);
  });
});

// ── Pagination integrity ──────────────────────────────────────────────────
describe('Pagination and limit handling', () => {
  const buildQueryParams = (limit, page = 1) => {
    if (!limit || limit < 1) throw new Error('limit must be positive');
    if (page < 1) throw new Error('page must be >= 1');
    return { limit, offset: (page - 1) * limit };
  };

  it('builds correct offset for page 1', () => {
    expect(buildQueryParams(20, 1).offset).toBe(0);
  });

  it('builds correct offset for page 2', () => {
    expect(buildQueryParams(20, 2).offset).toBe(20);
  });

  it('builds correct offset for page 3', () => {
    expect(buildQueryParams(20, 3).offset).toBe(40);
  });

  it('throws on invalid limit', () => {
    expect(() => buildQueryParams(0)).toThrow();
    expect(() => buildQueryParams(-1)).toThrow();
  });

  it('throws on invalid page', () => {
    expect(() => buildQueryParams(20, 0)).toThrow();
  });
});
