/**
 * lawyersScreen.logic.test.js
 * Tests LawyersScreen business logic:
 * - Lawyer list filtering (specialty, language, pro bono, search)
 * - Sort ordering (JTB verified first, then rating)
 * - Saved state management
 * - Search debounce behaviour
 * - Lawyer card data transformation
 * - Callback request validation
 * - Distance formatting
 */

// ── Data ──────────────────────────────────────────────────────────────────────
const MOCK_LAWYERS = [
  {
    id: 1, name: 'Sarah Mitchell', specialty: 'Criminal Defense',
    language: 'en', pro_bono: true,  rating: 4.9, reviews: 47,
    jtb_verified: true, bar_verified: true,  distance_km: 3.2,
    hourly_rate: 200, city: 'Knoxville', state: 'TN',
  },
  {
    id: 2, name: 'Marcus Thompson', specialty: 'DUI Defense',
    language: 'en', pro_bono: false, rating: 4.7, reviews: 31,
    jtb_verified: false, bar_verified: true, distance_km: 8.5,
    hourly_rate: 175, city: 'Knoxville', state: 'TN',
  },
  {
    id: 3, name: 'Maria Garcia', specialty: 'Immigration',
    language: 'es', pro_bono: true,  rating: 5.0, reviews: 89,
    jtb_verified: true, bar_verified: true, distance_km: 15.1,
    hourly_rate: null, city: 'Nashville', state: 'TN',
  },
  {
    id: 4, name: 'James Lee', specialty: 'Criminal Defense',
    language: 'vi', pro_bono: false, rating: 4.5, reviews: 12,
    jtb_verified: false, bar_verified: true, distance_km: 1.8,
    hourly_rate: 150, city: 'Memphis', state: 'TN',
  },
];

// ── Logic extracted from LawyersScreen ───────────────────────────────────────

function filterLawyers(lawyers, { caseType, language, proBonoOnly, searchQuery } = {}) {
  return lawyers.filter(l => {
    if (caseType && !l.specialty.toLowerCase().includes(caseType.toLowerCase())) return false;
    if (language && l.language !== language) return false;
    if (proBonoOnly && !l.pro_bono) return false;
    if (searchQuery?.trim()) {
      const q = searchQuery.toLowerCase();
      if (!l.name.toLowerCase().includes(q) &&
          !l.specialty.toLowerCase().includes(q) &&
          !l.city.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function sortLawyers(lawyers) {
  return [...lawyers].sort((a, b) => {
    // JTB verified first
    if (a.jtb_verified !== b.jtb_verified) return a.jtb_verified ? -1 : 1;
    // Then by rating descending
    return b.rating - a.rating;
  });
}

function formatRate(hourlyRate) {
  if (!hourlyRate) return 'Pro Bono / TBD';
  return `$${hourlyRate}/hr`;
}

function formatDistance(km) {
  if (!km && km !== 0) return '';
  const miles = km * 0.621371;
  return miles < 1 ? `${(miles * 5280).toFixed(0)} ft away` : `${miles.toFixed(1)} mi away`;
}

function formatRating(rating, reviews) {
  return `★ ${rating.toFixed(1)}  (${reviews} review${reviews !== 1 ? 's' : ''})`;
}

function isSaved(savedIds, lawyerId) {
  return savedIds.includes(lawyerId);
}

function toggleSavedId(savedIds, lawyerId) {
  return savedIds.includes(lawyerId)
    ? savedIds.filter(id => id !== lawyerId)
    : [...savedIds, lawyerId];
}

function validateCallbackRequest({ name, phone }) {
  const errors = [];
  if (!name?.trim()) errors.push('name required');
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 10) errors.push('valid phone required');
  return { valid: errors.length === 0, errors };
}

// Debounce — mirrors searchDebounce.current pattern
function createSearchDebounce(fn, delay) {
  let timer = null;
  return {
    call(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    },
    cancel() { clearTimeout(timer); timer = null; },
    flush(...args) { clearTimeout(timer); fn(...args); timer = null; },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
jest.useFakeTimers();

describe('LawyersScreen — Filter logic', () => {
  it('returns all lawyers with no filters', () => {
    expect(filterLawyers(MOCK_LAWYERS)).toHaveLength(4);
  });

  it('filters by case type (substring match)', () => {
    const result = filterLawyers(MOCK_LAWYERS, { caseType: 'criminal' });
    expect(result).toHaveLength(2);
    expect(result.every(l => l.specialty.toLowerCase().includes('criminal'))).toBe(true);
  });

  it('filters by language', () => {
    const es = filterLawyers(MOCK_LAWYERS, { language: 'es' });
    expect(es).toHaveLength(1);
    expect(es[0].name).toBe('Maria Garcia');

    const vi = filterLawyers(MOCK_LAWYERS, { language: 'vi' });
    expect(vi).toHaveLength(1);
    expect(vi[0].name).toBe('James Lee');
  });

  it('filters pro bono only', () => {
    const proBono = filterLawyers(MOCK_LAWYERS, { proBonoOnly: true });
    expect(proBono).toHaveLength(2);
    expect(proBono.every(l => l.pro_bono)).toBe(true);
  });

  it('filters by search query (name)', () => {
    const result = filterLawyers(MOCK_LAWYERS, { searchQuery: 'sarah' });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Sarah Mitchell');
  });

  it('filters by search query (city)', () => {
    const result = filterLawyers(MOCK_LAWYERS, { searchQuery: 'nashville' });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Maria Garcia');
  });

  it('combines multiple filters', () => {
    const result = filterLawyers(MOCK_LAWYERS, {
      caseType: 'criminal', proBonoOnly: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Sarah Mitchell');
  });

  it('returns empty when no lawyers match', () => {
    const result = filterLawyers(MOCK_LAWYERS, { language: 'pt' });
    expect(result).toHaveLength(0);
  });
});

describe('LawyersScreen — Sort logic', () => {
  it('puts JTB verified lawyers first', () => {
    const sorted = sortLawyers(MOCK_LAWYERS);
    const firstTwo = sorted.slice(0, 2);
    expect(firstTwo.every(l => l.jtb_verified)).toBe(true);
  });

  it('sorts by rating descending within JTB tier', () => {
    const sorted = sortLawyers(MOCK_LAWYERS);
    const verified = sorted.filter(l => l.jtb_verified);
    expect(verified[0].rating).toBeGreaterThanOrEqual(verified[1]?.rating ?? 0);
  });

  it('does not mutate the original array', () => {
    const original = [...MOCK_LAWYERS];
    sortLawyers(MOCK_LAWYERS);
    expect(MOCK_LAWYERS).toEqual(original);
  });
});

describe('LawyersScreen — Display formatting', () => {
  it('formats hourly rate', () => {
    expect(formatRate(200)).toBe('$200/hr');
    expect(formatRate(null)).toBe('Pro Bono / TBD');
    expect(formatRate(0)).toBe('Pro Bono / TBD');
  });

  it('formats distance in miles', () => {
    expect(formatDistance(3.2)).toContain('mi away');
    const close = formatDistance(0.1);
    expect(close).toContain('ft away');
  });

  it('formats rating with review count', () => {
    expect(formatRating(4.9, 47)).toBe('★ 4.9  (47 reviews)');
    expect(formatRating(5.0, 1)).toBe('★ 5.0  (1 review)');
  });
});

describe('LawyersScreen — Saved state', () => {
  it('detects saved lawyers', () => {
    expect(isSaved([1, 3], 1)).toBe(true);
    expect(isSaved([1, 3], 2)).toBe(false);
  });

  it('toggles lawyer into saved list', () => {
    const after = toggleSavedId([1, 3], 2);
    expect(after).toContain(2);
    expect(after).toHaveLength(3);
  });

  it('toggles lawyer out of saved list', () => {
    const after = toggleSavedId([1, 2, 3], 2);
    expect(after).not.toContain(2);
    expect(after).toHaveLength(2);
  });

  it('does not mutate original saved list', () => {
    const original = [1, 3];
    toggleSavedId(original, 2);
    expect(original).toHaveLength(2);
  });
});

describe('LawyersScreen — Callback request validation', () => {
  it('accepts valid name and phone', () => {
    const { valid } = validateCallbackRequest({ name: 'John Doe', phone: '(865) 555-1234' });
    expect(valid).toBe(true);
  });

  it('rejects empty name', () => {
    const { valid, errors } = validateCallbackRequest({ name: '', phone: '8655551234' });
    expect(valid).toBe(false);
    expect(errors).toContain('name required');
  });

  it('rejects phone with fewer than 10 digits', () => {
    const { valid, errors } = validateCallbackRequest({ name: 'John', phone: '12345' });
    expect(valid).toBe(false);
    expect(errors).toContain('valid phone required');
  });

  it('strips non-digit chars before counting', () => {
    const { valid } = validateCallbackRequest({ name: 'John', phone: '(865) 555-1234' });
    expect(valid).toBe(true);
  });
});

describe('LawyersScreen — Search debounce', () => {
  it('delays search execution until after delay', () => {
    const search = jest.fn();
    const debounced = createSearchDebounce(search, 400);

    debounced.call('kno');
    debounced.call('knox');
    debounced.call('knoxv');
    expect(search).not.toHaveBeenCalled();

    jest.advanceTimersByTime(400);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('knoxv');
  });

  it('resets timer on each keystroke', () => {
    const search = jest.fn();
    const debounced = createSearchDebounce(search, 400);

    debounced.call('a');
    jest.advanceTimersByTime(200);
    debounced.call('ab');
    jest.advanceTimersByTime(200);
    expect(search).not.toHaveBeenCalled();

    jest.advanceTimersByTime(200);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('ab');
  });
});
