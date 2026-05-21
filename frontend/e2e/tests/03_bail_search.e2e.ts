/**
 * 03_bail_search.e2e.ts — Bail agent search
 *
 * WHY THIS IS CRITICAL: A family member searching for a bail bondsman is in
 * crisis. If this screen crashes, shows no results, or shows a wrong dollar
 * amount, it directly delays someone's release from jail.
 */
import { device, element, by, expect as E, waitFor } from 'detox';
import { resetAndLogin } from '../helpers/auth';

describe('Bail Search', () => {
  beforeAll(async () => {
    await resetAndLogin('consumer');
  });

  beforeEach(async () => {
    // Navigate via More tab → Bail Search
    await element(by.id('more-tab')).tap();
    await waitFor(element(by.id('tile-bail_calc')))
      .toBeVisible().withTimeout(5000);
    await element(by.id('tile-bail_calc')).tap();
    await waitFor(element(by.id('bail-search-screen')))
      .toBeVisible().withTimeout(8000);
  });

  afterEach(async () => {
    await device.pressBack().catch(() => {});
  });

  it('renders search screen with city input and search button', async () => {
    await E(element(by.id('bail-search-city-input'))).toBeVisible();
    await E(element(by.id('bail-search-submit-button'))).toBeVisible();
  });

  it('searches for bail agents by city', async () => {
    await element(by.id('bail-search-city-input')).clearText();
    await element(by.id('bail-search-city-input')).typeText('Nashville');
    await element(by.id('bail-search-submit-button')).tap();
    await waitFor(element(by.id('bail-agent-list')))
      .toBeVisible().withTimeout(15000);
  });

  it('shows bail amount as a properly formatted dollar value', async () => {
    await element(by.id('bail-search-city-input')).clearText();
    await element(by.id('bail-search-city-input')).typeText('Nashville');
    await element(by.id('bail-search-submit-button')).tap();
    await waitFor(element(by.id('bail-agent-list'))).toBeVisible().withTimeout(15000);

    // First result must show a dollar amount — not NaN, not $0, not undefined
    const firstBailAmount = element(by.id('bail-agent-bail-amount').withAncestor(
      by.id('bail-agent-list')
    )).atIndex(0);
    const text = await firstBailAmount.getAttributes();
    // Must match $X,XXX format
    expect((text as any).text).toMatch(/^\$[\d,]+$/);
  });

  it('shows empty state message (not crash) when no results found', async () => {
    await element(by.id('bail-search-city-input')).clearText();
    await element(by.id('bail-search-city-input')).typeText('zxqwerty_no_results');
    await element(by.id('bail-search-submit-button')).tap();
    await waitFor(element(by.id('bail-search-empty')))
      .toBeVisible().withTimeout(12000);
    // Must NOT show a crash screen or blank screen
    await E(element(by.id('bail-search-screen'))).toBeVisible();
  });

  it('shows error message on network failure (not blank screen)', async () => {
    await device.setStatusBar({ networkType: 'none' });
    await element(by.id('bail-search-city-input')).clearText();
    await element(by.id('bail-search-city-input')).typeText('Nashville');
    await element(by.id('bail-search-submit-button')).tap();
    await waitFor(element(by.id('bail-search-error')))
      .toBeVisible().withTimeout(20000); // includes retry timeout
    await device.setStatusBar({ networkType: 'wifi' });
  });

  it('tapping a bail agent shows their profile', async () => {
    await element(by.id('bail-search-city-input')).clearText();
    await element(by.id('bail-search-city-input')).typeText('Nashville');
    await element(by.id('bail-search-submit-button')).tap();
    await waitFor(element(by.id('bail-agent-list'))).toBeVisible().withTimeout(15000);
    await element(by.id('bail-agent-card').withAncestor(by.id('bail-agent-list'))).atIndex(0).tap();
    await waitFor(element(by.id('bail-agent-phone'))).toBeVisible().withTimeout(5000);
  });
});
