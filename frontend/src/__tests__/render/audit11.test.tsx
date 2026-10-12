/**
 * Render tests for the audit11 frontend findings (real RN renderer, mocked api):
 *
 *   H10  TermsAcceptanceModal — when the summary fits the viewport (desktop web,
 *        tablets) there is no scroll event; "I Agree" must still become usable,
 *        and accepting records BOTH the ToS and the AI disclaimer.
 *   H12  BailCalculatorScreen — /legaldata/bail answers { data: [...] }; the
 *        screen must render the schedule and the bond breakdown, not crash with
 *        "x.filter is not a function".
 *   M3   SubscriptionScreen — prices come from the backend, no hard-coded or
 *        placement claims.
 *   M7   OnboardingScreen — slides take the carousel's measured width, not the
 *        window width (desktop web showed a blank centre slide).
 */
import React from 'react';
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../constants/theme';
import { ToastProvider } from '../../components/ToastProvider';

jest.mock('../../services/api', () => jest.requireActual<typeof import('./apiMock')>('./apiMock').apiMock().module);

import TermsAcceptanceModal, { contentFitsViewport } from '../../screens/TermsAcceptanceModal';
import BailCalculatorScreen from '../../screens/BailCalculatorScreen';
import SubscriptionScreen from '../../screens/SubscriptionScreen';
import OnboardingScreen from '../../screens/OnboardingScreen';
import { apiMock, makeNavigation } from './apiMock';

const { on, api, reset } = apiMock();
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);

beforeEach(() => reset());

describe('H10 — Terms gate on wide screens', () => {
  it('contentFitsViewport: fitting content counts as read; overflowing content does not', () => {
    expect(contentFitsViewport(500, 700)).toBe(true);     // desktop: everything visible
    expect(contentFitsViewport(720, 700)).toBe(true);     // within the bottom slack
    expect(contentFitsViewport(1600, 700)).toBe(false);   // phone: must scroll
  });

  it('when the summary fits, "I Agree" enables after both boxes and records ToS + AI disclaimer', async () => {
    on('post', '/auth/accept-tos', { ok: true });
    on('post', '/auth/disclaimer/accept', { accepted: true });
    const onAccepted = jest.fn();
    wrap(<TermsAcceptanceModal visible onAccepted={onAccepted} />);
    const scroll = screen.getByTestId('tos-scroll');
    // Desktop: a tall viewport, shorter content — and NO scroll event at all.
    fireEvent(scroll, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 600, height: 900 } } });
    fireEvent(scroll, 'contentSizeChange', 600, 640);
    fireEvent.press(screen.getByTestId('tos-check-terms'));
    fireEvent.press(screen.getByTestId('tos-check-no-advice'));
    const btn = screen.getByTestId('tos-accept-button');
    await waitFor(() => expect(btn.props.accessibilityState?.disabled).toBe(false));
    fireEvent.press(btn);
    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/auth/accept-tos', expect.objectContaining({ tos_version: expect.any(String) }));
    expect(api.post).toHaveBeenCalledWith('/auth/disclaimer/accept', {});
  });

  it('when the summary overflows (phone), "I Agree" stays disabled until scrolled to the end', async () => {
    wrap(<TermsAcceptanceModal visible onAccepted={jest.fn()} />);
    const scroll = screen.getByTestId('tos-scroll');
    fireEvent(scroll, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 400 } } });
    fireEvent(scroll, 'contentSizeChange', 390, 1600);
    fireEvent.press(screen.getByTestId('tos-check-terms'));
    fireEvent.press(screen.getByTestId('tos-check-no-advice'));
    const btn = screen.getByTestId('tos-accept-button');
    expect(btn.props.accessibilityState?.disabled).toBe(true);
    fireEvent.scroll(scroll, { nativeEvent: {
      layoutMeasurement: { height: 400, width: 390 }, contentOffset: { y: 1200, x: 0 }, contentSize: { height: 1600, width: 390 },
    } });
    await waitFor(() => expect(btn.props.accessibilityState?.disabled).toBe(false));
  });
});

describe('H12 — bail calculator renders the { data: [...] } envelope', () => {
  const ROWS = [
    { id: 11, state: 'TN', charge: 'DUI first offense', charge_class: 'Misdemeanor', bail_min: 1000, bail_max: 2500 },
    { id: 12, state: 'TN', charge: 'Aggravated assault', charge_class: 'Felony', bail_min: 10000, bail_max: 50000 },
  ];

  it('lists the schedule and shows the bondsman cost for a selected charge', async () => {
    on('get', /\/legaldata\/bail/, { data: ROWS, count: 2 });
    wrap(<BailCalculatorScreen navigation={makeNavigation()} route={{ params: {} } as any} />);
    const rows = await screen.findAllByTestId('bail-schedule-row');
    expect(rows).toHaveLength(2);
    expect(screen.queryByText(/Something went wrong/i)).toBeNull();
    fireEvent.press(rows[0]);
    expect(await screen.findByTestId('bail-bond-cost')).toBeTruthy();
    expect(screen.getByText('$100 - $250')).toBeTruthy();   // 10% of $1,000 – $2,500
  });

  it('a bare-array body (older API) still works', async () => {
    on('get', /\/legaldata\/bail/, ROWS);
    wrap(<BailCalculatorScreen navigation={makeNavigation()} route={{ params: {} } as any} />);
    expect(await screen.findAllByTestId('bail-schedule-row')).toHaveLength(2);
  });
});

describe('M3 — provider plans come from the backend', () => {
  it('shows the backend attorney and bondsman prices, no hard-coded or placement claims', async () => {
    on('get', '/billing/tiers', { tiers: [
      { key: 'esquire', audience: 'attorney', name: 'Justice Gavel Esquire', display_price: '$49.00/mo', billing: 'monthly', trial_days: 14 },
      { key: 'advisor', audience: 'consumer', name: '24 Hour Advisor', display_price: '$24.99/mo' },
    ] });
    on('get', '/billing/subscription', { subscription: null });
    on('get', '/billing/bondsman/tiers', { tiers: [
      { key: 'starter', name: 'Starter', display: '$49/mo', label: '1 county', annual_display: '$490/yr' },
      { key: 'pro', name: 'Pro', display: '$149/mo', label: '3 counties' },
      { key: 'market', name: 'Market', display: '$349/mo', label: 'DMA' },
    ] });
    on('get', '/billing/bondsman/subscription', { active: false });
    wrap(<SubscriptionScreen navigation={makeNavigation()} route={{ params: {} } as any} />);
    expect(await screen.findByTestId('plan-price-esquire')).toBeTruthy();
    expect(screen.getByText('$49.00/mo')).toBeTruthy();
    expect(screen.queryByText(/24 Hour Advisor/)).toBeNull();     // consumer plan not on the provider screen
    fireEvent.press(screen.getByTestId('provider-type-bail_agent'));
    expect(await screen.findByText('$149/mo')).toBeTruthy();
    expect(screen.getByText('$349/mo')).toBeTruthy();
    expect(screen.queryByText(/78\.99|198\.99|348\.99|48\.99/)).toBeNull();
    expect(screen.queryByText(/top placement/i)).toBeNull();
  });
});

describe('M7 — onboarding carousel uses the measured width', () => {
  it('slides are as wide as the carousel, not the window', async () => {
    wrap(<OnboardingScreen navigation={makeNavigation()} route={{ params: {} } as any} />);
    const carousel = screen.getByTestId('onboarding-carousel');
    await act(async () => {
      fireEvent(carousel, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 430, height: 500 } } });
    });
    const slides = screen.getAllByTestId('onboarding-slide');
    expect(slides.length).toBeGreaterThan(1);
    for (const s of slides) {
      const style = Array.isArray(s.props.style) ? Object.assign({}, ...s.props.style.flat()) : s.props.style;
      expect(style.width).toBe(430);
    }
    expect(screen.queryByText(/App Store/)).toBeNull();    // no invented store rating
  });
});
