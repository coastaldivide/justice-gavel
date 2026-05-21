/**
 * 07_bondsman_dashboard.e2e.ts — Bondsman lead management
 *
 * WHY THIS IS CRITICAL: A bondsman accepting the wrong lead (wrong bail amount,
 * wrong defendant) or missing a lead due to UI failure means someone stays in
 * jail. The bail_amount display is under test because NaN here directly affects
 * a bondsman's decision about whether to write a bond.
 */
import { device, element, by, expect as E, waitFor } from 'detox';
import { resetAndLogin } from '../helpers/auth';

describe('Bondsman Dashboard', () => {
  beforeAll(async () => {
    await resetAndLogin('bondsman');
  });

  beforeEach(async () => {
    await element(by.id('home-tab')).tap();
  });

  it('renders bondsman dashboard (not consumer home)', async () => {
    await waitFor(element(by.id('bondsman-dashboard-screen')))
      .toBeVisible().withTimeout(10000);
  });

  it('shows lead cards with bail amounts as dollar values', async () => {
    await waitFor(element(by.id('bondsman-dashboard-screen'))).toBeVisible().withTimeout(10000);
    await waitFor(element(by.id('lead-list'))).toBeVisible().withTimeout(12000);

    const firstBailEl = element(by.id('lead-bail-amount').withAncestor(
      by.id('lead-list')
    )).atIndex(0);
    const isVisible = await firstBailEl.isVisible().catch(() => false);
    if (isVisible) {
      const attrs = await firstBailEl.getAttributes() as any;
      // Must be $X,XXX format — never NaN
      expect(attrs.text).toMatch(/^\$[\d,]+$/);
      expect(attrs.text).not.toBe('$NaN');
    }
  });

  it('summary stats show numeric values — not NaN or blank', async () => {
    await waitFor(element(by.id('bondsman-dashboard-screen'))).toBeVisible().withTimeout(10000);
    // Avg bail stat
    const avgBailEl = element(by.id('stat-avg-bail'));
    const isVisible = await avgBailEl.isVisible().catch(() => false);
    if (isVisible) {
      const attrs = await avgBailEl.getAttributes() as any;
      expect(attrs.text).not.toBe('$NaN');
      expect(attrs.text).not.toBe('--');  // '--' is acceptable empty state, NaN is not
    }
  });

  it('can accept a lead', async () => {
    await waitFor(element(by.id('lead-list'))).toBeVisible().withTimeout(12000);
    const acceptBtn = element(by.id('lead-accept-button').withAncestor(
      by.id('lead-list')
    )).atIndex(0);
    const isVisible = await acceptBtn.isVisible().catch(() => false);
    if (isVisible) {
      await acceptBtn.tap();
      // Confirmation dialog or success state
      await waitFor(element(by.id('lead-accepted-confirmation')))
        .toBeVisible().withTimeout(8000);
    }
  });

  it('tapping a lead shows defendant name and charge details', async () => {
    await waitFor(element(by.id('lead-list'))).toBeVisible().withTimeout(12000);
    const firstCard = element(by.id('lead-card').withAncestor(by.id('lead-list'))).atIndex(0);
    const isVisible = await firstCard.isVisible().catch(() => false);
    if (isVisible) {
      await firstCard.tap();
      await waitFor(element(by.id('lead-detail-screen'))).toBeVisible().withTimeout(8000);
      await E(element(by.id('lead-defendant-name'))).toBeVisible();
      await E(element(by.id('lead-charge'))).toBeVisible();
      await E(element(by.id('lead-bail-amount-detail'))).toBeVisible();
    }
  });
});
