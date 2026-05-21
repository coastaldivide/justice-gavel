/**
 * 06_expungement.e2e.ts — Expungement eligibility checker
 *
 * WHY THIS IS CRITICAL: An incorrect "not eligible" result means someone
 * who could clear their record doesn't try. An incorrect "eligible" result
 * means they may pursue an expensive petition they'll lose. Accuracy here
 * has direct life consequences.
 */
import { device, element, by, expect as E, waitFor } from 'detox';
import { resetAndLogin } from '../helpers/auth';

describe('Expungement Checker', () => {
  beforeAll(async () => {
    await resetAndLogin('consumer');
  });

  beforeEach(async () => {
    await element(by.id('more-tab')).tap();
    await waitFor(element(by.id('tile-Expunge'))).toBeVisible().withTimeout(5000);
    await element(by.id('tile-Expunge')).tap();
    await waitFor(element(by.id('expungement-screen'))).toBeVisible().withTimeout(8000);
  });

  afterEach(async () => {
    await device.pressBack().catch(() => {});
  });

  it('renders the eligibility form', async () => {
    await E(element(by.id('expungement-state-picker'))).toBeVisible();
    await E(element(by.id('expungement-charges-input'))).toBeVisible();
    await E(element(by.id('expungement-check-button'))).toBeVisible();
  });

  it('requires state selection before submitting', async () => {
    await element(by.id('expungement-charges-input')).typeText('Misdemeanor theft');
    await element(by.id('expungement-check-button')).tap();
    // Must show validation error — not navigate to results
    await E(element(by.id('expungement-screen'))).toBeVisible();
    await E(element(by.id('expungement-state-error'))).toBeVisible();
  });

  it('returns a result (eligible or not) for TN misdemeanor', async () => {
    await element(by.id('expungement-state-picker')).tap();
    await element(by.text('Tennessee')).tap();
    await element(by.id('expungement-charges-input')).typeText('Misdemeanor theft under $500');
    await element(by.id('expungement-check-button')).tap();
    await waitFor(element(by.id('expungement-result-screen')))
      .toBeVisible().withTimeout(15000);
    // Result must show one of: eligible banner OR not-eligible banner — never blank
    const eligible    = await element(by.id('expungement-eligible-banner')).isVisible().catch(() => false);
    const notEligible = await element(by.id('expungement-not-eligible-banner')).isVisible().catch(() => false);
    expect(eligible || notEligible).toBe(true);
  });

  it('wait period shows a number — not NaN or undefined', async () => {
    await element(by.id('expungement-state-picker')).tap();
    await element(by.text('Tennessee')).tap();
    await element(by.id('expungement-charges-input')).typeText('DUI first offense');
    await element(by.id('expungement-check-button')).tap();
    await waitFor(element(by.id('expungement-result-screen'))).toBeVisible().withTimeout(15000);
    // If a wait period is shown, it must be a real number
    const waitEl = await element(by.id('expungement-wait-years')).isVisible().catch(() => false);
    if (waitEl) {
      const attrs = await element(by.id('expungement-wait-years')).getAttributes() as any;
      expect(attrs.text).not.toBe('NaN');
      expect(attrs.text).not.toBe('undefined');
      expect(Number(attrs.text.replace(/\D/g, ''))).toBeGreaterThanOrEqual(0);
    }
  });

  it('shows attorney referrals after eligible result', async () => {
    await element(by.id('expungement-state-picker')).tap();
    await element(by.text('Tennessee')).tap();
    await element(by.id('expungement-charges-input')).typeText('Simple possession marijuana');
    await element(by.id('expungement-check-button')).tap();
    await waitFor(element(by.id('expungement-result-screen'))).toBeVisible().withTimeout(15000);
    const eligible = await element(by.id('expungement-eligible-banner')).isVisible().catch(() => false);
    if (eligible) {
      await waitFor(element(by.id('expungement-attorneys-section')))
        .toBeVisible().withTimeout(10000);
    }
  });
});
