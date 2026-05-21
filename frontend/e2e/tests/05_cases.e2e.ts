/**
 * 05_cases.e2e.ts — Case management
 *
 * WHY THIS IS CRITICAL: The case screen is the central record for a user's
 * legal situation. Wrong case status, missing court dates, or failed saves
 * mean a person could miss a hearing or make decisions based on stale data.
 */
import { device, element, by, expect as E, waitFor } from 'detox';
import { resetAndLogin } from '../helpers/auth';

const TEST_CASE = {
  title: 'E2E Test Case — Delete Me',
  state: 'TN',
  charges: 'E2E test charge',
};

describe('Case Management', () => {
  beforeAll(async () => {
    await resetAndLogin('consumer');
  });

  beforeEach(async () => {
    await element(by.id('home-tab')).tap();
    await element(by.id('tile-Cases')).tap();
    await waitFor(element(by.id('case-screen'))).toBeVisible().withTimeout(10000);
  });

  afterEach(async () => {
    await device.pressBack().catch(() => {});
  });

  it('renders case screen — shows list or empty state', async () => {
    const hasList  = await element(by.id('case-list')).isVisible().catch(() => false);
    const hasEmpty = await element(by.id('case-empty-state')).isVisible().catch(() => false);
    expect(hasList || hasEmpty).toBe(true);
  });

  it('can create a new case', async () => {
    await element(by.id('case-add-button')).tap();
    await waitFor(element(by.id('case-title-input'))).toBeVisible().withTimeout(5000);
    await element(by.id('case-title-input')).typeText(TEST_CASE.title);
    await element(by.id('case-save-button')).tap();
    await waitFor(element(by.id('case-screen'))).toBeVisible().withTimeout(8000);
    // New case must appear in list
    await waitFor(element(by.text(TEST_CASE.title))).toBeVisible().withTimeout(5000);
  });

  it('shows court date in a readable format — not ISO string', async () => {
    // Court dates must render as human-readable (e.g. "Jan 15, 2026") not "2026-01-15T00:00:00Z"
    await waitFor(element(by.id('case-list'))).toBeVisible().withTimeout(10000);
    const dateEl = element(by.id('case-court-date').withAncestor(by.id('case-list'))).atIndex(0);
    const isVisible = await dateEl.isVisible().catch(() => false);
    if (isVisible) {
      const attrs = await dateEl.getAttributes() as any;
      // Must NOT contain 'T' (ISO timestamp) or 'Z' (UTC suffix)
      expect(attrs.text).not.toMatch(/T\d{2}:\d{2}:\d{2}/);
      expect(attrs.text).not.toMatch(/\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('shows bail amount as dollar value — not NaN or raw number', async () => {
    await waitFor(element(by.id('case-list'))).toBeVisible().withTimeout(10000);
    const bailEl = element(by.id('case-bail-amount').withAncestor(by.id('case-list'))).atIndex(0);
    const isVisible = await bailEl.isVisible().catch(() => false);
    if (isVisible) {
      const attrs = await bailEl.getAttributes() as any;
      expect(attrs.text).not.toBe('NaN');
      expect(attrs.text).not.toBe('$NaN');
      expect(attrs.text).toMatch(/^\$[\d,]+$|^--$|^N\/A$/);
    }
  });

  it('tapping a case navigates to its detail view', async () => {
    await waitFor(element(by.id('case-list'))).toBeVisible().withTimeout(10000);
    await element(by.id('case-card').withAncestor(by.id('case-list'))).atIndex(0).tap();
    await waitFor(element(by.id('case-detail-screen'))).toBeVisible().withTimeout(8000);
  });

  it('can share a case summary', async () => {
    await waitFor(element(by.id('case-list'))).toBeVisible().withTimeout(10000);
    await element(by.id('case-card')).atIndex(0).tap();
    await waitFor(element(by.id('case-detail-screen'))).toBeVisible().withTimeout(8000);
    await element(by.id('case-share-button')).tap();
    // Native share sheet must appear
    await waitFor(element(by.id('case-share-sheet'))).toBeVisible().withTimeout(5000);
    await device.pressBack();
  });
});
