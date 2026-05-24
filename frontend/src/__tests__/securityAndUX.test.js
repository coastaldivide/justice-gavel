/**
 * securityAndUX.test.js
 * Tests for role-based access, error message quality, and UX patterns
 */

// ── Role-based access control ────────────────────────────────────────────
describe('Role-based screen access', () => {
  const isAttorneyAllowed = (role) =>
    ['attorney', 'defender', 'admin'].includes(role);

  const isAdminAllowed = (user) =>
    user?.is_admin === true || user?.role === 'admin';

  it('allows attorney role on dashboard', () => {
    expect(isAttorneyAllowed('attorney')).toBe(true);
  });

  it('allows defender role on dashboard', () => {
    expect(isAttorneyAllowed('defender')).toBe(true);
  });

  it('allows admin role on dashboard', () => {
    expect(isAttorneyAllowed('admin')).toBe(true);
  });

  it('blocks consumer from attorney dashboard', () => {
    expect(isAttorneyAllowed('consumer')).toBe(false);
  });

  it('blocks null role from attorney dashboard', () => {
    expect(isAttorneyAllowed(null)).toBe(false);
  });

  it('grants admin access by is_admin flag', () => {
    expect(isAdminAllowed({ is_admin: true, role: 'consumer' })).toBe(true);
  });

  it('grants admin access by role field', () => {
    expect(isAdminAllowed({ role: 'admin' })).toBe(true);
  });

  it('blocks regular user from admin screen', () => {
    expect(isAdminAllowed({ role: 'attorney' })).toBe(false);
    expect(isAdminAllowed({ role: 'consumer' })).toBe(false);
  });

  it('blocks null user from admin screen', () => {
    expect(isAdminAllowed(null)).toBe(false);
    expect(isAdminAllowed(undefined)).toBe(false);
  });
});

// ── Error message quality ─────────────────────────────────────────────────
describe('Error message quality standards', () => {
  const GENERIC_TITLES = ['error', 'failed', 'oops', 'problem'];

  const isDescriptive = (title) =>
    !GENERIC_TITLES.includes(title.toLowerCase().trim());

  it('rejects generic "Error" title', () => {
    expect(isDescriptive('Error')).toBe(false);
  });

  it('rejects generic "Failed" title', () => {
    expect(isDescriptive('Failed')).toBe(false);
  });

  it('accepts specific "Could not Load" title', () => {
    expect(isDescriptive('Could not Load')).toBe(true);
  });

  it('accepts specific "Save Failed" title', () => {
    expect(isDescriptive('Save Failed')).toBe(true);
  });

  it('accepts specific "Submission Failed" title', () => {
    expect(isDescriptive('Submission Failed')).toBe(true);
  });

  it('accepts specific "Connection Error" title', () => {
    expect(isDescriptive('Connection Error')).toBe(true);
  });
});

// ── Biometric auth result handling ────────────────────────────────────────
describe('Biometric authentication', () => {
  const handleBiometricResult = (result) => {
    if (!result) return 'no-result';
    if (result.success) return 'authenticated';
    if (result.error === 'user_cancel') return 'cancelled';
    if (result.error === 'not_enrolled') return 'not-enrolled';
    return 'failed';
  };

  it('returns authenticated on success', () => {
    expect(handleBiometricResult({ success: true })).toBe('authenticated');
  });

  it('handles user cancellation gracefully', () => {
    expect(handleBiometricResult({ success: false, error: 'user_cancel' })).toBe('cancelled');
  });

  it('handles not enrolled state', () => {
    expect(handleBiometricResult({ success: false, error: 'not_enrolled' })).toBe('not-enrolled');
  });

  it('handles null result', () => {
    expect(handleBiometricResult(null)).toBe('no-result');
  });

  it('handles other failure', () => {
    expect(handleBiometricResult({ success: false, error: 'lockout' })).toBe('failed');
  });
});

// ── SkeletonLoader usage pattern ─────────────────────────────────────────
describe('Loading state UX', () => {
  // Skeleton should show during initial load, not spinner
  const getLoadingComponent = (isLoading, hasData, useSkeleton) => {
    if (isLoading && !hasData) {
      return useSkeleton ? 'skeleton' : 'spinner';
    }
    if (isLoading && hasData) return 'list-with-refresh';
    return 'list';
  };

  it('shows skeleton on initial load (no data yet)', () => {
    expect(getLoadingComponent(true, false, true)).toBe('skeleton');
  });

  it('shows spinner on initial load without skeleton', () => {
    expect(getLoadingComponent(true, false, false)).toBe('spinner');
  });

  it('shows list with refresh indicator when data exists', () => {
    expect(getLoadingComponent(true, true, true)).toBe('list-with-refresh');
  });

  it('shows list when done loading', () => {
    expect(getLoadingComponent(false, true, true)).toBe('list');
  });
});
