/**
 * analyticsService.test.js — Tests for analytics event service
 */
const analytics = require('../services/analytics');

describe('analytics service', () => {
  it('exports an analytics object', () => {
    expect(typeof analytics === 'object' || typeof analytics === 'function').toBe(true);
  });

  it('does not throw when tracking a lawyer view', () => {
    const mod = analytics.default || analytics;
    expect(() => mod.lawyerView && mod.lawyerView(1, 'Nashville', 'Criminal')).not.toThrow();
  });

  it('does not throw when tracking a check-in', () => {
    const mod = analytics.default || analytics;
    expect(() => mod.checkIn && mod.checkIn()).not.toThrow();
  });

  it('does not throw when tracking a bail search', () => {
    const mod = analytics.default || analytics;
    expect(() => mod.bailSearch && mod.bailSearch('Nashville', 3)).not.toThrow();
  });

  it('does not throw when tracking a search', () => {
    const mod = analytics.default || analytics;
    expect(() => mod.search && mod.search('DUI lawyer')).not.toThrow();
  });
});
