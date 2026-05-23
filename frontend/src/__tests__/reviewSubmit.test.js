/**
 * reviewSubmit.test.js — Tests for attorney review submission logic
 */

describe('Review validation', () => {
  const validateReview = (rating, text) => {
    if (!rating || rating < 1 || rating > 5) return 'Select a star rating (1-5)';
    if (text && text.length > 500) return 'Comment must be under 500 characters';
    return null;
  };

  it('rejects rating of 0', () => { expect(validateReview(0, 'Great')).toBeTruthy(); });
  it('rejects missing rating', () => { expect(validateReview(null, 'Great')).toBeTruthy(); });
  it('rejects rating > 5', () => { expect(validateReview(6, 'Good')).toBeTruthy(); });
  it('accepts valid rating with no comment', () => { expect(validateReview(4, '')).toBeNull(); });
  it('accepts valid rating with comment', () => { expect(validateReview(5, 'Excellent')).toBeNull(); });
  it('rejects comment over 500 chars', () => { expect(validateReview(5, 'A'.repeat(501))).toBeTruthy(); });
  it('accepts comment at exactly 500 chars', () => { expect(validateReview(3, 'A'.repeat(500))).toBeNull(); });
});

describe('Star rating display', () => {
  const renderStars = (rating, max = 5) =>
    Array.from({ length: max }, (_, i) => (i < rating ? '★' : '☆')).join('');

  it('renders 0 stars as all empty', () => { expect(renderStars(0)).toBe('☆☆☆☆☆'); });
  it('renders 5 stars as all filled', () => { expect(renderStars(5)).toBe('★★★★★'); });
  it('renders 3 stars correctly', () => { expect(renderStars(3)).toBe('★★★☆☆'); });
  it('renders 1 star correctly', () => { expect(renderStars(1)).toBe('★☆☆☆☆'); });
});
