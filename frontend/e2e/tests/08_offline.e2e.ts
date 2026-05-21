/**
 * 08_offline.e2e.ts — Offline behaviour
 *
 * WHY THIS IS CRITICAL: Users in rural courts, county jails, or underfunded
 * public defenders' offices often have poor connectivity. The app must degrade
 * gracefully — never crash, always show what's cached, always show a clear
 * "you are offline" message rather than a blank screen or spinner that never resolves.
 */
import { device, element, by, expect as E, waitFor } from 'detox';
import { resetAndLogin } from '../helpers/auth';

describe('Offline Behaviour', () => {
  beforeAll(async () => {
    await resetAndLogin('consumer');
    // Seed the cache by visiting key screens while online
    await element(by.id('tile-Lawyers')).tap();
    await waitFor(element(by.id('lawyer-list'))).toBeVisible().withTimeout(12000);
    await device.pressBack();
    await element(by.id('tile-Cases')).tap();
    await waitFor(element(by.id('case-screen'))).toBeVisible().withTimeout(8000);
    await device.pressBack();
  });

  beforeEach(async () => {
    // Go offline
    await device.setStatusBar({ networkType: 'none' });
    await element(by.id('home-tab')).tap();
  });

  afterEach(async () => {
    // Restore network
    await device.setStatusBar({ networkType: 'wifi' });
  });

  it('shows offline banner when no network', async () => {
    await waitFor(element(by.id('offline-banner')))
      .toBeVisible().withTimeout(8000);
  });

  it('still renders home screen tiles offline', async () => {
    await E(element(by.id('home-screen'))).toBeVisible();
    await E(element(by.id('tile-Cases'))).toBeVisible();
    await E(element(by.id('tile-Lawyers'))).toBeVisible();
  });

  it('shows cached lawyers list when offline', async () => {
    await element(by.id('tile-Lawyers')).tap();
    await waitFor(element(by.id('lawyers-screen'))).toBeVisible().withTimeout(8000);
    // Either shows cached data OR shows a clear offline message
    const hasList    = await element(by.id('lawyer-list')).isVisible().catch(() => false);
    const hasOffline = await element(by.id('lawyers-offline-message')).isVisible().catch(() => false);
    expect(hasList || hasOffline).toBe(true);
    // Must NOT show a blank white screen
    await E(element(by.id('lawyers-screen'))).toBeVisible();
  });

  it('shows cached cases when offline', async () => {
    await element(by.id('tile-Cases')).tap();
    await waitFor(element(by.id('case-screen'))).toBeVisible().withTimeout(8000);
    const hasList    = await element(by.id('case-list')).isVisible().catch(() => false);
    const hasEmpty   = await element(by.id('case-empty-state')).isVisible().catch(() => false);
    const hasOffline = await element(by.id('case-offline-message')).isVisible().catch(() => false);
    expect(hasList || hasEmpty || hasOffline).toBe(true);
  });

  it('does NOT crash when attempting check-in offline', async () => {
    await element(by.id('tile-CheckIn')).tap();
    await waitFor(element(by.id('checkin-screen'))).toBeVisible().withTimeout(8000);
    // Screen must be visible — not crashed
    await E(element(by.id('checkin-screen'))).toBeVisible();
    // Submit attempt must show error, not crash
    const hasSubmit = await element(by.id('checkin-submit-button')).isVisible().catch(() => false);
    if (hasSubmit) {
      await element(by.id('checkin-submit-button')).tap();
      await waitFor(element(by.id('checkin-error-message')))
        .toBeVisible().withTimeout(20000);
    }
  });

  it('recovers and loads fresh data when network returns', async () => {
    // Go back online
    await device.setStatusBar({ networkType: 'wifi' });
    await element(by.id('tile-Lawyers')).tap();
    await waitFor(element(by.id('lawyer-list'))).toBeVisible().withTimeout(15000);
    await E(element(by.id('lawyers-screen'))).toBeVisible();
  });
});
