/**
 * caseScreen.logic.test.js
 * Tests CaseScreen business logic:
 * - Case CRUD operations and state updates
 * - Offline/guest detection logic
 * - Hearing countdown and urgency detection
 * - Note autosave with debounce
 * - Case sharing token validation
 * - Family invite logic
 * - Unread message badge
 * - Document scan result parsing
 */

jest.useFakeTimers();

// ── Case data helpers ─────────────────────────────────────────────────────────

const STATUSES = ['Open', 'Active', 'Pre-Trial', 'In Progress', 'Discovery', 'Closed', 'Dismissed'];

function createCase({ title, charge, status = 'Open', court_date = null, notes = '' } = {}) {
  if (!title) throw new Error('title required');
  return {
    id:         Math.floor(Math.random() * 100000),
    title,
    charge:     charge || '',
    status,
    court_date,
    notes,
    created_at: new Date().toISOString(),
  };
}

function updateCase(existingCase, updates) {
  return { ...existingCase, ...updates };
}

// Mirror CaseScreen's local state merge after save
function mergeCaseInList(cases, updatedCase) {
  const idx = cases.findIndex(c => c.id === updatedCase.id);
  if (idx === -1) return [...cases, updatedCase];
  const next = [...cases];
  next[idx] = updatedCase;
  return next;
}

function removeCaseFromList(cases, caseId) {
  return cases.filter(c => c.id !== caseId);
}

// ── Offline / guest detection ─────────────────────────────────────────────────

function detectAuthState(apiError) {
  if (!apiError) return 'authenticated';
  const status = apiError?.response?.status;
  if (status === 401 || status === 403) return 'guest';
  if (!apiError.response) return 'offline';
  return 'error';
}

// ── Hearing countdown ─────────────────────────────────────────────────────────

function getDaysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return null;
  return Math.ceil((target - Date.now()) / 86400000);
}

function getHearingUrgency(daysUntil) {
  if (daysUntil === null) return 'none';
  if (daysUntil < 0)  return 'past';
  if (daysUntil <= 3) return 'critical';
  if (daysUntil <= 7) return 'urgent';
  return 'normal';
}

// ── Note autosave ─────────────────────────────────────────────────────────────

function makeAutosaver(saveFn, debounceMs = 1500) {
  let timer = null;
  return {
    update(text) {
      clearTimeout(timer);
      timer = setTimeout(() => saveFn(text), debounceMs);
    },
    cancel() { clearTimeout(timer); timer = null; },
  };
}

// ── Scan result parsing ────────────────────────────────────────────────────────
// Mirrors parseScanResult in CaseScreen

function parseScanResult(rawText) {
  const result = { title: '', charge: '', court_date: '', notes: '' };

  // Extract charge from text
  const chargeMatch = rawText.match(/charge[ds]?[:\s]+([^\n.]+)/i);
  if (chargeMatch) result.charge = chargeMatch[1].trim();

  // Extract date patterns
  const dateMatch = rawText.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\b/);
  if (dateMatch) result.court_date = dateMatch[1];

  // Use first meaningful line as title fallback
  const firstLine = rawText.split('\n').find(l => l.trim().length > 5);
  if (firstLine && !result.title) result.title = firstLine.trim().slice(0, 60);

  result.notes = rawText.trim().slice(0, 500);
  return result;
}

// ── Case sharing ──────────────────────────────────────────────────────────────

function validateShareToken(token) {
  if (!token || typeof token !== 'string') return false;
  return token.length >= 16 && /^[a-zA-Z0-9_-]+$/.test(token);
}

// ── Unread count display ──────────────────────────────────────────────────────

function formatUnreadBadge(count) {
  if (!count || count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

// ── Family invite ─────────────────────────────────────────────────────────────

function validateInviteEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email?.trim() ?? '');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CaseScreen — Case CRUD', () => {
  it('creates a case with required title', () => {
    const c = createCase({ title: 'State v. Smith', charge: 'DUI', status: 'Pre-Trial' });
    expect(c.title).toBe('State v. Smith');
    expect(c.status).toBe('Pre-Trial');
    expect(c.id).toBeTruthy();
  });

  it('throws when title is missing', () => {
    expect(() => createCase({ charge: 'DUI' })).toThrow('title required');
  });

  it('defaults status to Open', () => {
    const c = createCase({ title: 'Test Case' });
    expect(c.status).toBe('Open');
  });

  it('updates case fields non-destructively', () => {
    const original = createCase({ title: 'Old Title', charge: 'Misdemeanor' });
    const updated  = updateCase(original, { title: 'New Title', status: 'Closed' });
    expect(updated.title).toBe('New Title');
    expect(updated.status).toBe('Closed');
    expect(updated.charge).toBe('Misdemeanor');   // preserved
    expect(original.title).toBe('Old Title');      // not mutated
  });

  it('merges updated case into list', () => {
    const c1 = createCase({ title: 'Case A' });
    const c2 = createCase({ title: 'Case B' });
    const list = [c1, c2];
    const updated = updateCase(c1, { status: 'Closed' });
    const merged = mergeCaseInList(list, updated);
    expect(merged).toHaveLength(2);
    expect(merged.find(c => c.id === c1.id)?.status).toBe('Closed');
  });

  it('appends new case when id not in list', () => {
    const existing = [createCase({ title: 'Existing' })];
    const newCase  = createCase({ title: 'New' });
    const merged   = mergeCaseInList(existing, newCase);
    expect(merged).toHaveLength(2);
  });

  it('removes case from list by id', () => {
    const c1 = createCase({ title: 'Case A' });
    const c2 = createCase({ title: 'Case B' });
    const result = removeCaseFromList([c1, c2], c1.id);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(c2.id);
  });
});

describe('CaseScreen — Auth/offline detection', () => {
  it('returns authenticated when no error', () => {
    expect(detectAuthState(null)).toBe('authenticated');
  });

  it('detects 401 as guest', () => {
    expect(detectAuthState({ response: { status: 401 } })).toBe('guest');
  });

  it('detects 403 as guest', () => {
    expect(detectAuthState({ response: { status: 403 } })).toBe('guest');
  });

  it('detects missing response as offline', () => {
    expect(detectAuthState({ response: null })).toBe('offline');
    expect(detectAuthState({ code: 'ECONNABORTED' })).toBe('offline');
  });

  it('treats other status codes as error', () => {
    expect(detectAuthState({ response: { status: 500 } })).toBe('error');
  });
});

describe('CaseScreen — Hearing countdown', () => {
  it('returns null for missing court date', () => {
    expect(getDaysUntil(null)).toBeNull();
    expect(getDaysUntil('')).toBeNull();
  });

  it('returns correct days for future date', () => {
    const future = new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0];
    const days = getDaysUntil(future);
    expect(days).toBeGreaterThanOrEqual(4);
    expect(days).toBeLessThanOrEqual(6);
  });

  it('classifies urgency correctly', () => {
    expect(getHearingUrgency(null)).toBe('none');
    expect(getHearingUrgency(-1)).toBe('past');
    expect(getHearingUrgency(2)).toBe('critical');
    expect(getHearingUrgency(5)).toBe('urgent');
    expect(getHearingUrgency(30)).toBe('normal');
  });
});

describe('CaseScreen — Note autosave debounce', () => {
  it('fires save after debounce delay', () => {
    const save    = jest.fn();
    const saver   = makeAutosaver(save, 1500);
    saver.update('First draft');
    saver.update('Second draft');
    saver.update('Final draft');
    expect(save).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('Final draft');
  });

  it('cancel prevents save from firing', () => {
    const save  = jest.fn();
    const saver = makeAutosaver(save, 1500);
    saver.update('Draft text');
    saver.cancel();
    jest.advanceTimersByTime(2000);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('CaseScreen — Document scan parsing', () => {
  it('extracts charge from scanned text', () => {
    const raw = 'STATE OF TENNESSEE\nCharged: Possession with intent to distribute\nHearing: 12/15/2025';
    const result = parseScanResult(raw);
    expect(result.charge).toContain('Possession');
  });

  it('extracts court date from scanned text', () => {
    const raw = 'Case No: 2024-CR-0441\nHearing Date: 2025-06-15\nCourt: Knox County';
    const result = parseScanResult(raw);
    expect(result.court_date).toBe('2025-06-15');
  });

  it('extracts US date format', () => {
    const raw = 'Next appearance: 06/15/2025';
    const result = parseScanResult(raw);
    expect(result.court_date).toBe('06/15/2025');
  });

  it('stores raw text in notes (max 500 chars)', () => {
    const raw = 'A'.repeat(600);
    const result = parseScanResult(raw);
    expect(result.notes.length).toBeLessThanOrEqual(500);
  });

  it('handles empty scan result gracefully', () => {
    const result = parseScanResult('');
    expect(result.charge).toBe('');
    expect(result.court_date).toBe('');
  });
});

describe('CaseScreen — Sharing', () => {
  it('accepts valid share tokens', () => {
    expect(validateShareToken('abc123XYZ_-abcdef')).toBe(true);
    expect(validateShareToken('a'.repeat(16))).toBe(true);
  });

  it('rejects short or invalid tokens', () => {
    expect(validateShareToken('tooshort')).toBe(false);
    expect(validateShareToken('')).toBe(false);
    expect(validateShareToken(null)).toBe(false);
    expect(validateShareToken('has spaces here!!')).toBe(false);
  });
});

describe('CaseScreen — Unread badge', () => {
  it('returns null for zero unread', () => {
    expect(formatUnreadBadge(0)).toBeNull();
    expect(formatUnreadBadge(null)).toBeNull();
  });

  it('returns count as string for 1–99', () => {
    expect(formatUnreadBadge(1)).toBe('1');
    expect(formatUnreadBadge(5)).toBe('5');
    expect(formatUnreadBadge(99)).toBe('99');
  });

  it('caps at 99+ for large counts', () => {
    expect(formatUnreadBadge(100)).toBe('99+');
    expect(formatUnreadBadge(999)).toBe('99+');
  });
});

describe('CaseScreen — Family invite', () => {
  it('validates correct email addresses', () => {
    expect(validateInviteEmail('family@test.com')).toBe(true);
    expect(validateInviteEmail('spouse+tag@domain.co.uk')).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(validateInviteEmail('')).toBe(false);
    expect(validateInviteEmail('notanemail')).toBe(false);
    expect(validateInviteEmail('@nodomain.com')).toBe(false);
  });
});
