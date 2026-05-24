/**
 * reviewSubmit.test.js
 * Tests for review submission, lawyer save/unsave, and ID uniqueness
 */

// ── Review submit validation ──────────────────────────────────────────────
describe('Review form validation', () => {
  const validateReview = (rating, text) => {
    if (!rating || rating < 1 || rating > 5) return 'rating_required';
    if (typeof text !== 'string') return 'invalid_comment';
    if (text.length > 500) return 'comment_too_long';
    return 'valid';
  };

  it('requires rating 1-5', () => {
    expect(validateReview(0, '')).toBe('rating_required');
    expect(validateReview(6, '')).toBe('rating_required');
    expect(validateReview(null, '')).toBe('rating_required');
  });

  it('accepts all valid star ratings', () => {
    for (let r = 1; r <= 5; r++) {
      expect(validateReview(r, 'Great service')).toBe('valid');
    }
  });

  it('rejects comment over 500 characters', () => {
    expect(validateReview(4, 'x'.repeat(501))).toBe('comment_too_long');
  });

  it('accepts empty comment with valid rating', () => {
    expect(validateReview(3, '')).toBe('valid');
  });

  it('accepts comment exactly at 500 characters', () => {
    expect(validateReview(5, 'x'.repeat(500))).toBe('valid');
  });
});

// ── Save/unsave lawyer toggle ─────────────────────────────────────────────
describe('Lawyer save/unsave state machine', () => {
  const createSaveState = (initialSaved = false, initialId = null) => {
    let saved = initialSaved;
    let savedId = initialId;
    let saving = false;

    return {
      toggle: async (lawyerId, apiPost, apiDelete) => {
        if (saving) return;
        saving = true;
        try {
          if (saved && savedId) {
            await apiDelete(savedId);
            saved = false;
            savedId = null;
          } else {
            const res = await apiPost({ provider_id: lawyerId });
            saved = true;
            savedId = res.id;
          }
        } finally {
          saving = false;
        }
      },
      isSaved: () => saved,
      getId: () => savedId,
      isSaving: () => saving,
    };
  };

  it('saves unsaved lawyer', async () => {
    const state = createSaveState(false, null);
    const apiPost = jest.fn().mockResolvedValue({ id: 99 });
    const apiDelete = jest.fn();
    await state.toggle(1, apiPost, apiDelete);
    expect(state.isSaved()).toBe(true);
    expect(state.getId()).toBe(99);
  });

  it('unsaves saved lawyer', async () => {
    const state = createSaveState(true, 42);
    const apiPost = jest.fn();
    const apiDelete = jest.fn().mockResolvedValue(null);
    await state.toggle(1, apiPost, apiDelete);
    expect(state.isSaved()).toBe(false);
    expect(state.getId()).toBeNull();
  });

  it('does not double-save while saving', async () => {
    let callCount = 0;
    const state = createSaveState(false, null);
    const apiPost = jest.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({ id: callCount });
    });
    // Try to save twice simultaneously
    const p1 = state.toggle(1, apiPost, jest.fn());
    const p2 = state.toggle(1, apiPost, jest.fn());
    await Promise.all([p1, p2]);
    expect(apiPost).toHaveBeenCalledTimes(1);
  });
});

// ── Unique ID generation ──────────────────────────────────────────────────
describe('ID collision prevention', () => {
  let seq = 0;
  const generateTempId = () => `offline_${Date.now()}_${++seq}`;

  const generateMsgId = () => Date.now() + Math.floor(Math.random() * 10000);

  it('sequential temp IDs are always unique', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateTempId());
    }
    expect(ids.size).toBe(100);
  });

  it('message IDs have low collision probability', () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateMsgId());
    }
    // Should have high uniqueness (random 0-9999 spread over 1000 items)
    expect(ids.size).toBeGreaterThan(900);
  });

  it('temp ID format includes offline prefix', () => {
    expect(generateTempId()).toMatch(/^offline_\d+_\d+$/);
  });
});

// ── Emergency share validation ────────────────────────────────────────────
describe('Emergency share flow', () => {
  const validateEmergencyShare = (contacts, message) => {
    const active = contacts.filter(c => c && c.trim());
    if (active.length === 0) return 'no_contacts';
    if (!message || !message.trim()) return 'no_message';
    return { valid: true, recipientCount: active.length };
  };

  it('requires at least one contact', () => {
    expect(validateEmergencyShare([], 'Help')).toBe('no_contacts');
    expect(validateEmergencyShare(['', ''], 'Help')).toBe('no_contacts');
  });

  it('requires a message', () => {
    expect(validateEmergencyShare(['555-0100'], '')).toBe('no_message');
    expect(validateEmergencyShare(['555-0100'], '   ')).toBe('no_message');
  });

  it('returns recipient count for valid share', () => {
    const result = validateEmergencyShare(['555-0100', '555-0200'], 'I was arrested at...');
    expect(result.valid).toBe(true);
    expect(result.recipientCount).toBe(2);
  });

  it('counts only non-empty contacts', () => {
    const result = validateEmergencyShare(['555-0100', '', '555-0200'], 'Help');
    expect(result.recipientCount).toBe(2);
  });
});
