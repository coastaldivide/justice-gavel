/**
 * navigationSafety.test.js — Tests for navigation guard patterns
 */

describe('canGoBack guard', () => {
  const safeGoBack = (navigation) => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return true;
    }
    navigation.navigate('Home');
    return false;
  };

  it('calls goBack when stack has history', () => {
    const nav = { canGoBack: () => true, goBack: jest.fn(), navigate: jest.fn() };
    safeGoBack(nav);
    expect(nav.goBack).toHaveBeenCalled();
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('navigates to Home when stack is empty', () => {
    const nav = { canGoBack: () => false, goBack: jest.fn(), navigate: jest.fn() };
    safeGoBack(nav);
    expect(nav.navigate).toHaveBeenCalledWith('Home');
    expect(nav.goBack).not.toHaveBeenCalled();
  });

  it('returns true when goBack succeeds', () => {
    const nav = { canGoBack: () => true, goBack: jest.fn(), navigate: jest.fn() };
    expect(safeGoBack(nav)).toBe(true);
  });

  it('returns false when fallback navigation used', () => {
    const nav = { canGoBack: () => false, goBack: jest.fn(), navigate: jest.fn() };
    expect(safeGoBack(nav)).toBe(false);
  });
});

describe('Screen title trimming', () => {
  const truncateTitle = (title, max = 35) => {
    if (!title) return '';
    return title.length > max ? title.slice(0, max) + '...' : title;
  };

  it('returns empty string for null title', () => {
    expect(truncateTitle(null)).toBe('');
    expect(truncateTitle(undefined)).toBe('');
  });

  it('does not truncate short titles', () => {
    expect(truncateTitle('DUI Case')).toBe('DUI Case');
  });

  it('truncates long titles at 35 chars', () => {
    const long = 'A very long case title that exceeds the limit for display';
    const result = truncateTitle(long);
    expect(result.endsWith('...')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(38); // 35 + '...'
  });
});
