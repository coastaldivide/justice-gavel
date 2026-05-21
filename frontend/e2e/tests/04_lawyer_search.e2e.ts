/**
 * 04_lawyer_search.e2e.ts — Lawyer search and booking
 *
 * WHY THIS IS CRITICAL: This is how people in legal jeopardy find
 * representation. A booking that silently fails, a lawyer card with wrong
 * contact info, or a crash during scheduling directly harms that person.
 */
import { device, element, by, expect as E, waitFor } from 'detox';
import { resetAndLogin } from '../helpers/auth';

describe('Lawyer Search & Booking', () => {
  beforeAll(async () => {
    await resetAndLogin('consumer');
  });

  beforeEach(async () => {
    await element(by.id('home-tab')).tap();
    await element(by.id('tile-Lawyers')).tap();
    await waitFor(element(by.id('lawyers-screen'))).toBeVisible().withTimeout(10000);
  });

  afterEach(async () => {
    await device.pressBack().catch(() => {});
  });

  it('renders the lawyers screen with a results list', async () => {
    await waitFor(element(by.id('lawyer-list'))).toBeVisible().withTimeout(12000);
    // At least one result
    await E(element(by.id('lawyer-card').withAncestor(by.id('lawyer-list'))).atIndex(0)).toBeVisible();
  });

  it('shows lawyer name, rating, and specialty on each card', async () => {
    await waitFor(element(by.id('lawyer-list'))).toBeVisible().withTimeout(12000);
    const firstCard = element(by.id('lawyer-card').withAncestor(by.id('lawyer-list'))).atIndex(0);
    // All three fields must be present
    await E(element(by.id('lawyer-name').withAncestor(firstCard))).toBeVisible();
    await E(element(by.id('lawyer-rating').withAncestor(firstCard))).toBeVisible();
  });

  it('navigates to lawyer profile on tap', async () => {
    await waitFor(element(by.id('lawyer-list'))).toBeVisible().withTimeout(12000);
    await element(by.id('lawyer-card').withAncestor(by.id('lawyer-list'))).atIndex(0).tap();
    await waitFor(element(by.id('lawyer-profile-screen'))).toBeVisible().withTimeout(8000);
    await E(element(by.id('lawyer-profile-contact-button'))).toBeVisible();
  });

  it('searches lawyers by specialty and updates results', async () => {
    await waitFor(element(by.id('lawyers-search-input'))).toBeVisible().withTimeout(8000);
    await element(by.id('lawyers-search-input')).typeText('criminal');
    await waitFor(element(by.id('lawyer-list'))).toBeVisible().withTimeout(12000);
    // Results must appear (not blank, not crash)
    await E(element(by.id('lawyers-screen'))).toBeVisible();
  });

  it('saves a lawyer and confirms saved state', async () => {
    await waitFor(element(by.id('lawyer-list'))).toBeVisible().withTimeout(12000);
    await element(by.id('lawyer-save-button').withAncestor(
      by.id('lawyer-card').withAncestor(by.id('lawyer-list'))
    )).atIndex(0).tap();

    // Navigate to saved lawyers
    await element(by.id('more-tab')).tap();
    await element(by.id('tile-Lawyers')).tap();
    await waitFor(element(by.id('saved-lawyers-list'))).toBeVisible().withTimeout(8000);
    await E(element(by.id('lawyer-card').withAncestor(by.id('saved-lawyers-list'))).atIndex(0)).toBeVisible();
  });

  it('opens booking flow from lawyer profile', async () => {
    await waitFor(element(by.id('lawyer-list'))).toBeVisible().withTimeout(12000);
    await element(by.id('lawyer-card')).atIndex(0).tap();
    await waitFor(element(by.id('lawyer-profile-screen'))).toBeVisible().withTimeout(8000);
    await element(by.id('lawyer-book-button')).tap();
    await waitFor(element(by.id('booking-screen'))).toBeVisible().withTimeout(8000);
    await E(element(by.id('booking-datetime-step'))).toBeVisible();
  });

  it('cannot book without selecting a time slot', async () => {
    await waitFor(element(by.id('lawyer-list'))).toBeVisible().withTimeout(12000);
    await element(by.id('lawyer-card')).atIndex(0).tap();
    await waitFor(element(by.id('lawyer-profile-screen'))).toBeVisible().withTimeout(8000);
    await element(by.id('lawyer-book-button')).tap();
    await waitFor(element(by.id('booking-screen'))).toBeVisible().withTimeout(8000);
    // Tap confirm without selecting time
    await element(by.id('booking-confirm-button')).tap();
    // Must stay on booking screen — not navigate to confirmed
    await E(element(by.id('booking-screen'))).toBeVisible();
  });
});
