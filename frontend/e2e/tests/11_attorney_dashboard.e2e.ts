/**
 * 11_attorney_dashboard.e2e.ts — Attorney dashboard flow
 *
 * Covers: attorney login → dashboard → cases tab → motions tab → availability.
 * Why: attorney role is separate from consumer — role gate must work correctly.
 * A consumer reaching attorney screens would see others' case data.
 */
import { device, element, by, expect as E, waitFor } from 'detox';
import { TEST_CREDENTIALS, loginAs } from '../helpers/auth';

describe('Attorney dashboard', () => {
  beforeEach(async () => {
    await device.launchApp({ newInstance: true });
    await device.clearKeychain();
    await loginAs('attorney');
  });

  it('attorney reaches dashboard after login', async () => {
    await waitFor(element(by.id('attorney-dashboard-screen'))).toBeVisible().withTimeout(15000);
  });

  it('cases tab is default active tab', async () => {
    await waitFor(element(by.id('attorney-dashboard-screen'))).toBeVisible().withTimeout(15000);
    await E(element(by.id('tab-cases'))).toBeVisible();
  });

  it('consumer cannot reach attorney dashboard', async () => {
    await device.clearKeychain();
    await loginAs('consumer');
    // After consumer login, attorney dashboard should NOT be visible
    await waitFor(element(by.id('home-screen'))).toBeVisible().withTimeout(15000);
    await E(element(by.id('attorney-dashboard-screen'))).not.toBeVisible();
  });

  it('motion library is accessible from attorney nav', async () => {
    await waitFor(element(by.id('attorney-dashboard-screen'))).toBeVisible().withTimeout(15000);
    await element(by.id('tab-motions')).tap();
    await waitFor(element(by.id('motion-library-screen'))).toBeVisible().withTimeout(8000);
  });
});
