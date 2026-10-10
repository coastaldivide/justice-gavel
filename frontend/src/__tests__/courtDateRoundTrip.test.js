/**
 * courtDateRoundTrip.test.js — a court date entered as 'YYYY-MM-DD' must show
 * the same calendar day after the API round trip, whatever the device TZ.
 * Run under several zones: TZ=America/Los_Angeles / UTC / Pacific/Auckland.
 *
 * The API returns DATE columns as 'YYYY-MM-DD'. Older API builds and offline
 * caches hold the same value as a midnight-UTC timestamp; both must render as
 * the entered day.
 */
const { parseLocalDate, formatDate, toLocalISODate, daysUntil } = require('../utils/dateUtils');

describe('court date round trip', () => {
  const entered = '2026-11-20';

  it.each([
    ['date-only string (current API)', '2026-11-20'],
    ['midnight UTC, ms + Z (old API / cache)', '2026-11-20T00:00:00.000Z'],
    ['midnight UTC, no ms', '2026-11-20T00:00:00Z'],
    ['midnight UTC, +00:00 offset', '2026-11-20T00:00:00+00:00'],
  ])('%s renders as the entered day', (_label, fromApi) => {
    const d = parseLocalDate(fromApi);
    expect(d).not.toBeNull();
    expect(toLocalISODate(d)).toBe(entered);
    expect(formatDate(fromApi)).toBe('Nov 20, 2026');
  });

  it('what the case form sends (toLocalISODate) survives the trip unchanged', () => {
    const picked = new Date(2026, 10, 20, 21, 30);   // 9:30 pm local on Nov 20
    const sent = toLocalISODate(picked);
    expect(sent).toBe(entered);
    expect(formatDate(sent)).toBe('Nov 20, 2026');
  });

  it('real timestamps (not midnight UTC) are still instants', () => {
    const iso = '2026-11-20T15:30:00Z';
    expect(parseLocalDate(iso).getTime()).toBe(Date.parse(iso));
  });

  it('daysUntil counts calendar days for a date-only value', () => {
    const today = toLocalISODate(new Date());
    expect(daysUntil(today)).toBeLessThanOrEqual(0);
    expect(daysUntil(today)).toBeGreaterThan(-1);
  });
});
