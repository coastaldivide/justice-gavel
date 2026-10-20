/**
 * Render tests for the audit11 frontend findings (real RN renderer, mocked api):
 *
 *   H10  TermsAcceptanceModal — when the summary fits the viewport (desktop web,
 *        tablets) there is no scroll event; "I Agree" must still become usable,
 *        and accepting records BOTH the ToS and the AI disclaimer.
 *   H12  BailCalculatorScreen — /legaldata/bail answers { data: [...] }; the
 *        screen must render the schedule and the bond breakdown, not crash with
 *        "x.filter is not a function".
 *   (M3 SubscriptionScreen moved to proDashboards.test.tsx)
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

  it('lists the schedule; a selected charge shows the range and an honest fee note (no invented %)', async () => {
    on('get', /\/help\/bail-schedule/, { data: ROWS, count: 2 });
    wrap(<BailCalculatorScreen navigation={makeNavigation()} route={{ params: {} } as any} />);
    const rows = await screen.findAllByTestId('bail-schedule-row');
    expect(rows).toHaveLength(2);
    expect(screen.queryByText(/Something went wrong/i)).toBeNull();
    fireEvent.press(rows[0]);
    expect(await screen.findByTestId('bail-fee-note')).toBeTruthy();
    expect(screen.getAllByText('$1,000 - $2,500').length).toBeGreaterThan(0);
    expect(screen.queryByText(/10%/)).toBeNull();
    expect(screen.queryByText('$100 - $250')).toBeNull();
  });

  it('a bare-array body (older API) still works', async () => {
    on('get', /\/help\/bail-schedule/, ROWS);
    wrap(<BailCalculatorScreen navigation={makeNavigation()} route={{ params: {} } as any} />);
    expect(await screen.findAllByTestId('bail-schedule-row')).toHaveLength(2);
  });
});

// M3 (provider plans from the backend) moved to proDashboards.test.tsx with the section G plan screens.

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
