/**
 * e2e/helpers/auth.ts — shared authentication helpers
 * Uses dedicated test accounts that are reset before each run.
 */
import { device, element, by, expect as detoxExpect } from 'detox';

export const TEST_CREDENTIALS = {
  consumer: { email: 'e2e.consumer@justicegavel.test', password: 'E2E_Test_2025!' },
  esquire: { email: 'e2e.attorney@justicegavel.test', password: 'E2E_Test_2025!' },
  bondsman: { email: 'e2e.bondsman@justicegavel.test', password: 'E2E_Test_2025!' },
};

export async function loginAs(role: keyof typeof TEST_CREDENTIALS) {
  const creds = TEST_CREDENTIALS[role];
  try {
    await detoxExpect(element(by.id('home-screen'))).toBeVisible();
    return; // already logged in
  } catch { /* not on home — proceed */ }

  await detoxExpect(element(by.id('login-email-input'))).toBeVisible();
  await element(by.id('login-email-input')).typeText(creds.email);
  await element(by.id('login-password-input')).typeText(creds.password);
  await element(by.id('login-submit-button')).tap();
  await detoxExpect(element(by.id('home-screen'))).toBeVisible();
}

export async function logout() {
  await element(by.id('settings-tab')).tap();
  await element(by.id('settings-logout-button')).tap();
  await element(by.text('Sign out')).tap();
  await detoxExpect(element(by.id('login-email-input'))).toBeVisible();
}

export async function resetAndLogin(role: keyof typeof TEST_CREDENTIALS) {
  await device.clearKeychain();
  await device.launchApp({ newInstance: true });
  await loginAs(role);
}
