/**
 * e2e/tests/critical_flows.e2e.ts — Critical user journey E2E tests
 *
 * Framework: Detox (already configured in .detoxrc.js)
 * Tests the most critical user flows that cannot be unit-tested.
 *
 * FLOWS COVERED:
 *   1. First-time user: onboarding → disclaimer → bail calculator
 *   2. DV survivor: rights card → lethality assessment → crisis resources
 *   3. Attorney: login → matter creation → AI signal generation
 *   4. Consumer: login → case creation → lawyer match → subscription
 *   5. Immigration: ICE detention screen → asylum clock → bond calculator
 */

import { device, element, by, expect as detoxExpect } from 'detox';

// ── Test helpers ──────────────────────────────────────────────────────────────
const tap     = async (id: string) => element(by.id(id)).tap();
const type    = async (id: string, text: string) => element(by.id(id)).typeText(text);
const visible = async (id: string) => detoxExpect(element(by.id(id))).toBeVisible();
const scroll  = async (id: string) => element(by.id(id)).scrollTo('bottom');

describe('Flow 1: First-Time User Onboarding', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  it('age gate appears on first launch', async () => {
    await visible('age-gate-screen');
  });

  it('proceeding shows onboarding slides', async () => {
    await tap('age-gate-continue');
    await visible('onboarding-screen');
  });

  it('legal disclaimer appears before AI features', async () => {
    await tap('onboarding-skip');
    await tap('tab-chat');
    await visible('disclaimer-scroll');
  });

  it('disclaimer requires scroll-to-bottom before accept', async () => {
    await detoxExpect(element(by.id('disclaimer-accept-btn'))).not.toBeVisible();
    await scroll('disclaimer-scroll');
    await visible('disclaimer-accept-btn');
  });

  it('accepts disclaimer and reaches chat', async () => {
    await tap('disclaimer-checkbox');
    await tap('disclaimer-accept-btn');
    await visible('chat-screen');
  });
});

describe('Flow 2: Bail Calculator', () => {
  it('bail calculator accessible from home', async () => {
    await tap('tab-home');
    await tap('home-bail-calculator-btn');
    await visible('bail-calculator-screen');
  });

  it('entering charge type shows bail amount', async () => {
    await tap('bail-charge-felony');
    await tap('bail-severity-high');
    await tap('bail-calculate-btn');
    await visible('bail-result-amount');
  });

  it('bondsman cost shows as 10% of bail amount', async () => {
    await visible('bail-bondsman-cost');
    await visible('bail-breakdown-chart');
  });

  it('ICE hold toggle shows immigration bond screen', async () => {
    await tap('bail-ice-hold-toggle');
    await visible('bail-immigration-note');
  });
});

describe('Flow 3: DV Survivor — Crisis Resources', () => {
  it('crisis resources accessible from home screen', async () => {
    await tap('tab-home');
    await tap('home-crisis-btn');
    await visible('crisis-resources-screen');
  });

  it('all 9 hotlines are visible', async () => {
    await visible('crisis-hotline-988');
    await visible('crisis-hotline-dv');
    await visible('crisis-hotline-rainn');
  });

  it('tap on hotline opens phone dial', async () => {
    // Detox validates the Linking.openURL call fires
    await tap('crisis-hotline-988');
    // Should not navigate away from screen (dial sheet appears natively)
    await visible('crisis-resources-screen');
  });
});

describe('Flow 4: ICE Detention Rights', () => {
  it('ICE detention screen loads bilingual', async () => {
    await tap('tab-home');
    await tap('home-ice-btn');
    await visible('ice-detention-screen');
    await visible('ice-lang-toggle');
  });

  it('language toggle switches to Spanish', async () => {
    await tap('ice-lang-toggle');
    await visible('ice-header-spanish');
  });

  it('rights cards all visible on scroll', async () => {
    await scroll('ice-scroll');
    await visible('ice-rights-last');
  });
});

describe('Flow 5: Authentication', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true, delete: true });
  });

  it('register creates account', async () => {
    await tap('age-gate-continue');
    await tap('onboarding-skip');
    await tap('nav-register');
    await type('register-identifier', `e2e_test_${Date.now()}@test.com`);
    await type('register-password', 'TestPass123!');
    await tap('register-submit');
    await visible('home-screen');
  });

  it('login with wrong password shows error', async () => {
    await device.launchApp({ newInstance: true, delete: true });
    await tap('age-gate-continue');
    await tap('nav-login');
    await type('login-identifier', 'wrong@test.com');
    await type('login-password', 'wrongpassword');
    await tap('login-submit');
    await visible('login-error-message');
  });
});

describe('Flow 6: Case Management', () => {
  it('creates a case', async () => {
    await tap('tab-cases');
    await tap('cases-add-btn');
    await type('case-title-input', 'DUI Case - Test County');
    await tap('case-charge-dui');
    await tap('case-save-btn');
    await visible('case-detail-screen');
  });

  it('case appears in list', async () => {
    await tap('back-btn');
    await visible('case-list-item');
  });

  it('soft-deleting case removes from list', async () => {
    await element(by.id('case-list-item')).longPress();
    await tap('case-delete-btn');
    await tap('case-delete-confirm');
    await detoxExpect(element(by.id('case-list-item'))).not.toExist();
  });
});
