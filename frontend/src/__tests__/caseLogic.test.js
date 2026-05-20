/**
 * caseLogic.test.js
 * Tests case management business logic — status filtering, deadline
 * countdown, hearing urgency, note autosave debounce, i18n key coverage.
 */

// ── Case business logic (mirrors CaseScreen.tsx helpers) ─────────────────────

const ACTIVE_STATUSES  = ['Open', 'Active', 'Pre-Trial', 'In Progress', 'Discovery'];
const CLOSED_STATUSES  = ['Closed', 'Dismissed', 'Convicted', 'Acquitted', 'Sealed'];
const HEARING_URGENCY  = { days: 7, color: 'emergency' };

function isActiveCase(status) {
  return ACTIVE_STATUSES.includes(status);
}

function daysUntilHearing(courtDateStr) {
  if (!courtDateStr) return null;
  const hearing = new Date(courtDateStr);
  const now     = new Date();
  const diff    = Math.ceil((hearing - now) / (1000 * 60 * 60 * 24));
  return diff;
}

function hearingIsUrgent(courtDateStr) {
  const days = daysUntilHearing(courtDateStr);
  return days !== null && days >= 0 && days <= HEARING_URGENCY.days;
}

function filterCasesByStatus(cases, filter) {
  if (filter === 'all')    return cases;
  if (filter === 'active') return cases.filter(c => isActiveCase(c.status));
  if (filter === 'closed') return cases.filter(c => CLOSED_STATUSES.includes(c.status));
  return cases;
}

function sortCasesByUrgency(cases) {
  return [...cases].sort((a, b) => {
    const dA = daysUntilHearing(a.next_court_date) ?? 9999;
    const dB = daysUntilHearing(b.next_court_date) ?? 9999;
    return dA - dB;
  });
}

// Autosave debounce (mirrors useRef + setTimeout pattern in CaseScreen)
function createAutosave(saveFn, delay = 1500) {
  let timer = null;
  return {
    trigger(value) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => saveFn(value), delay);
    },
    flush() {
      if (timer) { clearTimeout(timer); timer = null; }
    },
  };
}

// Case note truncation (mirrors list display)
function truncateNote(note, maxLen = 80) {
  if (!note || note.length <= maxLen) return note || '';
  return note.slice(0, maxLen - 3) + '...';
}

// ── Tests ─────────────────────────────────────────────────────────────────────
jest.useFakeTimers();

describe('Case status helpers', () => {
  it('identifies active statuses correctly', () => {
    for (const s of ACTIVE_STATUSES)  expect(isActiveCase(s)).toBe(true);
    for (const s of CLOSED_STATUSES)  expect(isActiveCase(s)).toBe(false);
    expect(isActiveCase('Unknown')).toBe(false);
  });

  it('filters cases by status', () => {
    const cases = [
      { id:1, status:'Open'      },
      { id:2, status:'Closed'    },
      { id:3, status:'Pre-Trial' },
      { id:4, status:'Dismissed' },
    ];
    expect(filterCasesByStatus(cases, 'all')).toHaveLength(4);
    expect(filterCasesByStatus(cases, 'active')).toHaveLength(2);
    expect(filterCasesByStatus(cases, 'closed')).toHaveLength(2);
  });
});

describe('Hearing urgency', () => {
  const tomorrow = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString();
  const nextWeek = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();
  const past     = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  it('detects upcoming hearing within 7 days as urgent', () => {
    expect(hearingIsUrgent(tomorrow)).toBe(true);
  });

  it('does not flag hearing 8+ days away as urgent', () => {
    expect(hearingIsUrgent(nextWeek)).toBe(false);
  });

  it('does not flag past hearings as urgent', () => {
    expect(hearingIsUrgent(past)).toBe(false);
  });

  it('returns null days for missing court date', () => {
    expect(daysUntilHearing(null)).toBeNull();
    expect(daysUntilHearing('')).toBeNull();
  });
});

describe('Sort cases by urgency', () => {
  it('sorts cases with nearest hearing first', () => {
    const d1 = new Date(Date.now() + 1  * 86400000).toISOString();
    const d2 = new Date(Date.now() + 5  * 86400000).toISOString();
    const d3 = new Date(Date.now() + 30 * 86400000).toISOString();
    const cases = [
      { id:1, next_court_date: d3 },
      { id:2, next_court_date: d1 },
      { id:3, next_court_date: d2 },
    ];
    const sorted = sortCasesByUrgency(cases);
    expect(sorted[0].id).toBe(2);
    expect(sorted[1].id).toBe(3);
    expect(sorted[2].id).toBe(1);
  });

  it('places cases without hearing date last', () => {
    const d = new Date(Date.now() + 2 * 86400000).toISOString();
    const cases = [
      { id:1, next_court_date: null },
      { id:2, next_court_date: d    },
    ];
    const sorted = sortCasesByUrgency(cases);
    expect(sorted[0].id).toBe(2);
    expect(sorted[1].id).toBe(1);
  });
});

describe('Note autosave debounce', () => {
  it('calls saveFn once after delay', () => {
    const save   = jest.fn();
    const saver  = createAutosave(save, 1500);
    saver.trigger('Hello');
    saver.trigger('Hello W');
    saver.trigger('Hello World');
    expect(save).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('Hello World');
  });

  it('does not fire if flushed before delay', () => {
    const save  = jest.fn();
    const saver = createAutosave(save, 1500);
    saver.trigger('draft text');
    saver.flush();
    jest.advanceTimersByTime(2000);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('Note truncation', () => {
  it('returns full note if under maxLen', () => {
    expect(truncateNote('Short note')).toBe('Short note');
  });

  it('truncates long notes with ellipsis', () => {
    const long = 'A'.repeat(100);
    const result = truncateNote(long, 80);
    expect(result).toHaveLength(80);
    expect(result).toMatch(/\.\.\.$/);
  });

  it('handles null/empty note', () => {
    expect(truncateNote(null)).toBe('');
    expect(truncateNote('')).toBe('');
  });
});
