/**
 * errorMessages.test.js — Tests for user-facing error message quality
 */

describe('Error message normalization', () => {
  const normalizeError = (e) => {
    if (!e) return 'Something went wrong. Please try again.';
    const raw = typeof e === 'string' ? e : (e.message || String(e));
    // Filter out technical messages
    if (raw.includes('Network request failed') || raw.includes('Failed to fetch')) {
      return 'Could not connect. Check your internet connection.';
    }
    if (raw.includes('401') || raw.includes('Unauthorized')) {
      return 'Your session expired. Please log in again.';
    }
    if (raw.includes('404')) {
      return 'The requested information was not found.';
    }
    if (raw.includes('500') || raw.includes('Internal server error')) {
      return 'Server error. Please try again later.';
    }
    if (raw.length > 100) return 'Something went wrong. Please try again.';
    return raw;
  };

  it('handles null/undefined gracefully', () => {
    expect(normalizeError(null)).toBeTruthy();
    expect(normalizeError(undefined)).toBeTruthy();
  });

  it('converts network errors to user-friendly message', () => {
    expect(normalizeError(new Error('Network request failed'))).toContain('internet');
  });

  it('converts 401 to session expired message', () => {
    expect(normalizeError(new Error('401 Unauthorized'))).toContain('session');
  });

  it('converts 500 to server error message', () => {
    expect(normalizeError(new Error('Internal server error'))).toContain('Server error');
  });

  it('truncates very long raw errors', () => {
    const longErr = 'A'.repeat(150);
    const result = normalizeError(new Error(longErr));
    expect(result).toBe('Something went wrong. Please try again.');
  });

  it('passes through short human-readable errors unchanged', () => {
    const msg = 'Please enter your email address.';
    expect(normalizeError(new Error(msg))).toBe(msg);
  });
});
