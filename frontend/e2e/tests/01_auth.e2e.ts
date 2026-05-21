/**
 * 01_auth.e2e.ts — Authentication flows
 *
 * Covers: registration, login, logout, wrong password, token persistence.
 * Why these matter: every other flow depends on auth working correctly.
 * A silent auth failure means a user can't access their case data or check in.
 */
import { device, element, by, expect as E, waitFor } from 'detox';
import { TEST_CREDENTIALS } from '../helpers/auth';

describe('Authentication', () => {
  beforeEach(async () => {
    await device.clearKeychain();
    await device.launchApp({ newInstance: true });
  });

  // ── Login ────────────────────────────────────────────────────────────────────

  it('shows login screen on cold launch with no token', async () => {
    await E(element(by.id('login-email-input'))).toBeVisible();
    await E(element(by.id('login-password-input'))).toBeVisible();
    await E(element(by.id('login-submit-button'))).toBeVisible();
  });

  it('logs in successfully with valid consumer credentials', async () => {
    const { email, password } = TEST_CREDENTIALS.consumer;
    await element(by.id('login-email-input')).typeText(email);
    await element(by.id('login-password-input')).typeText(password);
    await element(by.id('login-submit-button')).tap();
    await waitFor(element(by.id('home-screen')))
      .toBeVisible().withTimeout(15000);
  });

  it('shows error on wrong password — does NOT navigate away', async () => {
    await element(by.id('login-email-input')).typeText(TEST_CREDENTIALS.consumer.email);
    await element(by.id('login-password-input')).typeText('wrong-password-xyz');
    await element(by.id('login-submit-button')).tap();
    // Must stay on login screen
    await E(element(by.id('login-email-input'))).toBeVisible();
    // Must show an error message (not a crash)
    await waitFor(element(by.id('login-error-message')))
      .toBeVisible().withTimeout(8000);
  });

  it('shows error on unregistered email', async () => {
    await element(by.id('login-email-input')).typeText('nobody@notreal.test');
    await element(by.id('login-password-input')).typeText('any-password');
    await element(by.id('login-submit-button')).tap();
    await waitFor(element(by.id('login-error-message')))
      .toBeVisible().withTimeout(8000);
  });

  it('persists login token across app restarts', async () => {
    const { email, password } = TEST_CREDENTIALS.consumer;
    await element(by.id('login-email-input')).typeText(email);
    await element(by.id('login-password-input')).typeText(password);
    await element(by.id('login-submit-button')).tap();
    await waitFor(element(by.id('home-screen'))).toBeVisible().withTimeout(15000);

    // Background and relaunch WITHOUT clearing keychain
    await device.sendToHome();
    await device.launchApp({ newInstance: false });
    // Should go directly to home — no login required
    await waitFor(element(by.id('home-screen'))).toBeVisible().withTimeout(10000);
  });

  // ── Registration ─────────────────────────────────────────────────────────────

  it('navigates to registration screen', async () => {
    await element(by.id('login-register-link')).tap();
    await E(element(by.id('register-screen'))).toBeVisible();
  });

  it('shows validation error on short password during registration', async () => {
    await element(by.id('login-register-link')).tap();
    await element(by.id('register-email-input')).typeText('new@test.test');
    await element(by.id('register-password-input')).typeText('short');
    await element(by.id('register-submit-button')).tap();
    await E(element(by.id('register-error-message'))).toBeVisible();
    // Must NOT navigate to home — bad password rejected
    await E(element(by.id('register-screen'))).toBeVisible();
  });

  // ── Logout ───────────────────────────────────────────────────────────────────

  it('logs out and returns to login screen', async () => {
    const { email, password } = TEST_CREDENTIALS.consumer;
    await element(by.id('login-email-input')).typeText(email);
    await element(by.id('login-password-input')).typeText(password);
    await element(by.id('login-submit-button')).tap();
    await waitFor(element(by.id('home-screen'))).toBeVisible().withTimeout(15000);

    await element(by.id('more-tab')).tap();
  await element(by.text('Settings')).tap();
    await element(by.id('settings-logout-button')).tap();
    await element(by.text('Sign out')).tap();

    // Must return to login — no stored token
    await waitFor(element(by.id('login-email-input'))).toBeVisible().withTimeout(8000);

    // Re-launching must also land on login
    await device.launchApp({ newInstance: true });
    await E(element(by.id('login-email-input'))).toBeVisible();
  });
});
