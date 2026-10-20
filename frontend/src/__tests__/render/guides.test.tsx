/**
 * guides.test.tsx — section F (specialized legal guides) regressions.
 *
 *  1  Expungement sends the chosen state / outcome / charge type to the server
 *     (they went in cachedGet's TTL argument, so every check was "Tennessee,
 *     unknown"), shows the verdict with the statute it names, and a rule without
 *     a statute gets no verdict and no waiting period
 *  2  Expungement as a guest never calls the signed-in-only log-visit
 *  3  Child support never shows a dollar estimate (it used an invented table)
 *  4  Diversion never says "you may qualify" (it counted yes answers into a verdict)
 *     and opens on the mental-health tab from "MentalHealthDiversion"
 *  5  Hague: the country list and the authority come from the server (stored data)
 *     with their source line
 *  6  SourceLine: "none recorded" without a source; no date part without a date
 */
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../../constants/theme';
import { ToastProvider } from '../../components/ToastProvider';
import ExpungementScreen from '../../screens/ExpungementScreen';
import ChildSupportScreen from '../../screens/ChildSupportScreen';
import DiversionScreen from '../../screens/DiversionScreen';
import HagueContactScreen from '../../screens/HagueContactScreen';
import { SourceLine } from '../../components/LegalSource';

jest.mock('../../services/api', () => jest.requireActual<typeof import('./apiMock')>('./apiMock').apiMock().module);
const mockToken = { value: null as string | null };
jest.mock('../../utils/secureStorage', () => ({
  __esModule: true,
  getToken: jest.fn(() => Promise.resolve(mockToken.value)),
  setToken: jest.fn(() => Promise.resolve()),
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
  clearAuth: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../services/haptics', () => ({ __esModule: true, hapticSuccess: jest.fn(), hapticWarn: jest.fn(), hapticSelect: jest.fn(), hapticCall: jest.fn() }));
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const R = jest.requireActual('react');
  return { ...actual, useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]), useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) };
});

const { on, api, reset } = jest.requireActual<typeof import('./apiMock')>('./apiMock').apiMock();
const { makeNavigation } = jest.requireActual<typeof import('./apiMock')>('./apiMock');
const { t } = jest.requireActual<typeof import('../../i18n')>('../../i18n');
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);

const result = (over: Record<string, unknown> = {}) => ({
  state: 'CA', stateName: 'California', chargeType: 'dismissed', status: 'Dismissed', notes_lang: 'en',
  eligibility: { result: 'eligible', waitYears: 0, note: 'Dismissed charges immediately eligible for petition to seal. PC 851.91.', citation: 'PC 851.91' },
  source: { label: 'Statute named in the recorded rule: PC 851.91', citation: 'PC 851.91', recorded_at: '2026-08-09', reviewed: false },
  partners: [], disclaimer: 'General information only.', ...over,
});

beforeEach(() => { reset(); mockToken.value = null; });

describe('1–2 Expungement', () => {
  it('sends state, outcome and type as params and shows the sourced verdict', async () => {
    on('get', '/expungement/check', result());
    on('get', '/expungement/attorneys', { attorneys: [{ id: 7, name: 'Ana Law', city: 'Fresno', phone: '+15595550100', state: 'CA' }] });
    const Screen = ExpungementScreen;
    wrap(<Screen navigation={makeNavigation()} route={{ key: 'e', name: 'Expungement', params: { state: 'CA' } }} />);
    fireEvent.press(await screen.findByTestId('expungement-status-Dismissed'));
    fireEvent.press(screen.getByTestId('expungement-check-button'));
    expect(await screen.findByText(t('exp_r_eligible'))).toBeTruthy();
    const call = api.get.mock.calls.find(c => c[0] === '/expungement/check');
    expect(call?.[1]).toMatchObject({ params: { state: 'CA', status: 'Dismissed' } });
    expect(screen.getByTestId('expungement-source').props.children).toMatch(/PC 851\.91/);
    expect(await screen.findByText('Ana Law ›')).toBeTruthy();
  });

  it('a rule naming no statute: no verdict, no waiting period, labelled source', async () => {
    on('get', '/expungement/check', result({
      state: 'TN', stateName: 'Tennessee', chargeType: 'domestic', status: 'Convicted',
      eligibility: { result: 'unsourced', waitYears: null, note: 'Domestic violence convictions not expungeable in Tennessee.', citation: null },
      source: { label: null, citation: null, recorded_at: '2026-08-09', reviewed: false },
    }));
    on('get', '/expungement/attorneys', { attorneys: [] });
    const Screen = ExpungementScreen;
    wrap(<Screen navigation={makeNavigation()} route={{ key: 'e', name: 'Expungement', params: { state: 'TN' } }} />);
    fireEvent.press(await screen.findByTestId('expungement-type-domestic'));
    fireEvent.press(screen.getByTestId('expungement-check-button'));
    expect(await screen.findByText(t('exp_r_unsourced'))).toBeTruthy();
    expect(api.get.mock.calls.find(c => c[0] === '/expungement/check')?.[1]).toMatchObject({ params: { state: 'TN', status: 'Convicted', type: 'domestic' } });
    expect(screen.queryByTestId('expungement-wait-years')).toBeNull();
    expect(screen.getByTestId('expungement-source').props.children).toContain(t('pen_source_unknown'));
    expect(screen.queryByTestId('expungement-draft')).toBeNull();
  });

  it('as a guest it never calls log-visit', async () => {
    const Screen = ExpungementScreen;
    wrap(<Screen navigation={makeNavigation()} route={{ key: 'e', name: 'Expungement' }} />);
    await screen.findByTestId('expungement-check-button');
    await new Promise(r => { setTimeout(r, 50); });
    expect(api.post.mock.calls.some(c => c[0] === '/expungement/log-visit')).toBe(false);
  });
});

describe('3 Child support', () => {
  it('shows "no official formula" for the state and never a dollar amount', async () => {
    const Screen = ChildSupportScreen;
    wrap(<Screen navigation={makeNavigation()} route={{ key: 'c', name: 'ChildSupport', params: { state: 'GA' } }} />);
    expect(await screen.findByText(t('cs_unavailable_title', { state: 'Georgia' }))).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/\$\s?\d/);
  });
});

describe('4 Diversion', () => {
  it('opens on mental health from MentalHealthDiversion and gives no verdict', async () => {
    const Screen = DiversionScreen;
    wrap(<Screen navigation={makeNavigation()} route={{ key: 'd', name: 'MentalHealthDiversion' }} />);
    const tab = screen.getByTestId('diversion-tab-mental').props;
    expect(tab['aria-selected'] ?? tab.accessibilityState?.selected).toBe(true);
    fireEvent(screen.getByTestId('diversion-q-diagnosis'), 'valueChange', true);
    expect(await screen.findByTestId('diversion-summary')).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/may qualify|criteria met/i);
  });
});

describe('5 Hague', () => {
  it('lists the stored countries and shows the authority with its source', async () => {
    const src = { label: 'HCCH member state registry', url: 'https://www.hcch.net/en/states/authorities', recorded_at: '2026-05-30', last_verified_at: null };
    on('get', '/hague-contacts/us-resources', {
      central_authority: { country_code: 'US', country_name: 'United States', contracting_state: true, note: 'n',
        central_authority: { name: 'Office of Children’s Issues', website: 'https://travel.state.gov', phone: '+1-202-501-4444', emergency_phone: '+1-888-407-4747', email: null }, source: { ...src, label: 'U.S. Department of State' } },
      resources: [],
    });
    on('get', '/hague-contacts/member-states', { member_states: [{ code: 'MX', name: 'Mexico', contracting: true }] });
    on('get', '/hague-contacts/central-authority/MX', {
      country_code: 'MX', country_name: 'Mexico', contracting_state: true, note: 'Recorded as a partner.',
      central_authority: { name: 'Secretaría de Gobernación — SEGOB', website: 'https://www.gob.mx/segob', phone: null, emergency_phone: null, email: null }, source: src,
    });
    const Screen = HagueContactScreen;
    wrap(<Screen navigation={makeNavigation()} route={{ key: 'h', name: 'HagueContact' }} />);
    expect(await screen.findByTestId('hague-us-authority')).toBeTruthy();
    fireEvent.press(screen.getByTestId('hague-open-lookup'));
    fireEvent.press(await screen.findByTestId('hague-country-MX'));
    expect(await screen.findByText('Secretaría de Gobernación — SEGOB')).toBeTruthy();
    expect(screen.getByTestId('hague-authority-source').props.children).toMatch(/HCCH member state registry/);
  });
});

describe('6 SourceLine', () => {
  it('says "none recorded" and leaves out the date part when there is no date', () => {
    wrap(<SourceLine testID="s1" />);
    expect(screen.getByTestId('s1').props.children).toBe(t('src_source_only', { source: t('pen_source_unknown') }));
    wrap(<SourceLine testID="s2" source="FBI" recorded="2026-05-30" />);
    expect(screen.getByTestId('s2').props.children).toMatch(/FBI .* 2026 · /);
  });
});

