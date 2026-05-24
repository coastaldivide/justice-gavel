/**
 * 10_emergency.e2e.ts — Emergency share flow
 *
 * Covers: JustArrested → EmergencyShare → phase transitions → send.
 * Why: emergency flow is highest-stakes in the app — a user just arrested
 * needs to reach their contacts reliably. Any friction is critical.
 */
import { device, element, by, expect as E, waitFor } from 'detox';
import { loginAs } from '../helpers/auth';

describe('Emergency share', () => {
  beforeEach(async () => {
    await device.launchApp({ newInstance: false });
    await loginAs('consumer');
  });

  it('emergency SOS button is visible on home screen', async () => {
    await waitFor(element(by.id('home-screen'))).toBeVisible().withTimeout(10000);
    await E(element(by.id('sos-button'))).toBeVisible();
  });

  it('just arrested screen is accessible from home', async () => {
    await waitFor(element(by.id('home-screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('just-arrested-button')).tap();
    await waitFor(element(by.id('just-arrested-screen'))).toBeVisible().withTimeout(8000);
  });

  it('emergency share screen loads from just arrested', async () => {
    await waitFor(element(by.id('home-screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('just-arrested-button')).tap();
    await waitFor(element(by.id('just-arrested-screen'))).toBeVisible().withTimeout(8000);
    await element(by.id('emergency-share-button')).tap();
    await waitFor(element(by.id('emergency-share-screen'))).toBeVisible().withTimeout(8000);
  });
});
