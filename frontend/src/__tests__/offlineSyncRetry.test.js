/**
 * offlineSyncRetry.test.js — Tests for offline sync queue retry logic
 */

describe('Sync queue retry logic', () => {
  const RETRY_LIMIT = 3;

  const shouldRetry = (attempt, status) => {
    return status !== 'success' && attempt < RETRY_LIMIT;
  };

  it('retries on first failure', () => {
    expect(shouldRetry(0, 'failed')).toBe(true);
  });

  it('retries on second failure', () => {
    expect(shouldRetry(1, 'failed')).toBe(true);
  });

  it('stops after retry limit', () => {
    expect(shouldRetry(3, 'failed')).toBe(false);
    expect(shouldRetry(4, 'failed')).toBe(false);
  });

  it('does not retry on success', () => {
    expect(shouldRetry(0, 'success')).toBe(false);
  });

  it('RETRY_LIMIT is 3', () => {
    expect(RETRY_LIMIT).toBe(3);
  });
});

describe('Sync queue item prioritization', () => {
  const sortByPriority = (items) =>
    [...items].sort((a, b) => {
      // checkin > case > motion
      const priority = { checkin: 0, case: 1, motion: 2 };
      return (priority[a.type] ?? 99) - (priority[b.type] ?? 99);
    });

  it('check-ins are processed before cases', () => {
    const items = [
      { type: 'case', id: 1 },
      { type: 'checkin', id: 2 },
    ];
    const sorted = sortByPriority(items);
    expect(sorted[0].type).toBe('checkin');
  });

  it('cases are processed before motions', () => {
    const items = [
      { type: 'motion', id: 1 },
      { type: 'case', id: 2 },
    ];
    const sorted = sortByPriority(items);
    expect(sorted[0].type).toBe('case');
  });

  it('unknown types sort to end', () => {
    const items = [
      { type: 'unknown', id: 1 },
      { type: 'checkin', id: 2 },
    ];
    const sorted = sortByPriority(items);
    expect(sorted[0].type).toBe('checkin');
  });
});
