/**
 * Render tests: LawyersScreen + BailSearchScreen (section C) — server order
 * kept, contact links well-formed, paging to the end, no-location search,
 * filters that narrow (and say so), save/unsave synced, skeleton loops that
 * never hold InteractionManager.
 */
import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Animated, Linking } from 'react-native';
import { ThemeProvider } from '../../constants/theme';
import { ToastProvider } from '../../components/ToastProvider';

jest.mock('../../services/api', () => jest.requireActual<typeof import('./apiMock')>('./apiMock').apiMock().module);
let mockToken: string | null = 'jwt-test';
jest.mock('../../utils/secureStorage', () => ({
  __esModule: true,
  getToken: jest.fn(() => Promise.resolve(mockToken)),
  setToken: jest.fn(() => Promise.resolve()),
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
  clearAuth: jest.fn(() => Promise.resolve()),
}));
let mockGpsFails = false;
jest.mock('../../services/location', () => ({
  __esModule: true,
  // The real getLocationWithCity never rejects: without permission it returns
  // the default point with permissionGranted:false, source:'default'.
  getLocationWithCity: jest.fn(() => Promise.resolve(mockGpsFails
    ? { lat: 36.1627, lng: -86.7816, city: 'Nashville, TN', source: 'default', permissionGranted: false }
    : { lat: 36.16, lng: -86.78, city: 'Nashville', source: 'gps', permissionGranted: true })),
  detectAndSaveUserState: jest.fn(() => Promise.resolve('TN')),
  formatDistance: (km: number | null) => (km == null ? '' : `${km} km`),
}));
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const R = jest.requireActual('react');
  return { ...actual, useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]), useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }) };
});
jest.mock('../../services/offlineCache', () => ({
  __esModule: true,
  getCachedLawyers: jest.fn(() => Promise.resolve({ isCache: false, data: [], lawyers: [] })),
  cacheSearch: jest.fn(() => Promise.resolve()),
  cacheSavedLawyers: jest.fn(() => Promise.resolve()),
  cacheBailAgents: jest.fn(() => Promise.resolve()),
  getCachedBailAgents: jest.fn(() => Promise.resolve({ agents: [], age: '' })),
  cacheAgeLabel: jest.fn(() => ''),
}));

import LawyersScreen from '../../screens/LawyersScreen';
import BailSearchScreen from '../../screens/BailSearchScreen';

import { apiMock, makeNavigation } from './apiMock';
const { on, api, reset } = apiMock();

const LAWYERS = [
  { id: 1, name: 'Ada Counsel', phone: '615-555-0001', address: '1 Main St', city: 'Nashville', state: 'TN',
    rating: 4.9, reviews: 12, verified: true, specialties: ['Criminal Defense'], languages: ['English'],
    distanceKm: 2.1, distanceMi: 1.3, golden_gavel: false, gavel_level: 0, availability: 'accepting' },
  { id: 2, name: 'Ben Barrister', phone: '615-555-0002', address: '2 Main St', city: 'Nashville', state: 'TN',
    rating: 4.2, reviews: 3, verified: false, specialties: ['DUI'], languages: ['English', 'Spanish'],
    distanceKm: 5.4, distanceMi: 3.4, golden_gavel: false, gavel_level: 0, availability: 'accepting' },
];

const AGENTS = [
  { id: 11, name: 'Fast Bonds', phone: '615-555-0100', address: '9 Jail Rd', city: 'Nashville', state: 'TN',
    rating: 4.7, reviews: 20, verified: true, available_24_7: true, payment_plans: true, distanceKm: 1.2 },
];

function wrap(node: React.ReactElement) {
  return render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
}

beforeEach(async () => {
  reset();
  jest.clearAllMocks();
  mockGpsFails = false;
  mockToken = 'jwt-test';
  await AsyncStorage.clear();
  // LawyersScreen shows a first-visit "What do you need help with?" modal and
  // only auto-fetches once it has been dismissed; mark it as already seen.
  // (The first-visit behaviour itself is covered by its own test below.)
  await AsyncStorage.setItem('lawyers_need_shown', '1');
});

const linkSpy = () => jest.spyOn(Linking, 'openURL').mockImplementation(() => Promise.resolve(true));
const lawyersCall = () => api.get.mock.calls.filter((c: any[]) => c[0] === '/providers/lawyers');
const bailCall = () => api.get.mock.calls.filter((c: any[]) => c[0] === '/providers/bail');

describe('LawyersScreen', () => {
  it('first visit shows the "what do you need?" modal instead of fetching', async () => {
    await AsyncStorage.removeItem('lawyers_need_shown');
    wrap(<LawyersScreen navigation={makeNavigation()} route={{ params: {} }} />);
    expect(await screen.findByText('What do you need help with?')).toBeTruthy();
    expect(api.get).not.toHaveBeenCalledWith('/providers/lawyers', expect.anything());
  });

  it('first visit: every need has an icon (Appeals had none → "undefined55" colours)', async () => {
    await AsyncStorage.removeItem('lawyers_need_shown');
    wrap(<LawyersScreen navigation={makeNavigation()} route={{ params: {} }} />);
    await screen.findByText('What do you need help with?');
    expect(screen.getByTestId('need-Appeals')).toBeTruthy();
    // the need's icon is an Ionicon from ICONS (no emoji), decorative to screen readers
    const icon = screen.getByTestId('need-Appeals').findAll((n: any) => n.props && n.props.accessibilityElementsHidden === true);
    expect(icon.length).toBeGreaterThan(0);
  });

  it('loads lawyers near the user in the SERVER order (no client re-sort by rating)', async () => {
    on('get', '/providers/lawyers', [...LAWYERS].reverse());
    on('get', '/reviews/summary', { avg_rating: 4.5, count: 2, top_reviews: [] });
    wrap(<LawyersScreen navigation={makeNavigation()} route={{ params: {} }} />);
    await screen.findByText('Ada Counsel');
    const names = screen.getAllByTestId('lawyer-name').map(n => n.props.children);
    expect(names).toEqual(['Ben Barrister', 'Ada Counsel']);
    expect(lawyersCall()[0][1].params).toMatchObject({ lat: 36.16, lng: -86.78 });
  });

  it('every card can call (formatted number, tel:+1…), text, get directions and open the website', async () => {
    const spy = linkSpy();
    on('get', '/providers/lawyers', [{ ...LAWYERS[0], phone: '+16155550001', lat: 36.1, lng: -86.7, website: 'example-law.com' }]);
    on('get', '/reviews/summary', { avg_rating: null, count: 0, top_reviews: [] });
    wrap(<LawyersScreen navigation={makeNavigation()} route={{ params: {} }} />);
    expect(await screen.findByText('Call (615) 555-0001')).toBeTruthy();
    fireEvent.press(screen.getByTestId('contact-call'));
    fireEvent.press(screen.getByTestId('contact-text'));
    fireEvent.press(screen.getByTestId('contact-directions'));
    fireEvent.press(screen.getByTestId('contact-website'));
    expect(spy.mock.calls.map(c => c[0])).toEqual([
      'tel:+16155550001', 'sms:+16155550001',
      'https://maps.apple.com/?daddr=36.1%2C-86.7&q=Ada%20Counsel', 'https://example-law.com/',   // jest runs as iOS
    ]);
    spy.mockRestore();
  });

  it('a listing without a phone says so (no dead Call button)', async () => {
    on('get', '/providers/lawyers', [{ ...LAWYERS[0], phone: null }]);
    on('get', '/reviews/summary', { avg_rating: null, count: 0, top_reviews: [] });
    wrap(<LawyersScreen navigation={makeNavigation()} route={{ params: {} }} />);
    expect(await screen.findByTestId('contact-no-phone')).toBeTruthy();
    expect(screen.queryByTestId('contact-call')).toBeNull();
  });

  it('booking / messaging only for lawyers on the app', async () => {
    on('get', '/providers/lawyers', [{ ...LAWYERS[0], on_app: false }, { ...LAWYERS[1], on_app: true }]);
    on('get', '/reviews/summary', { avg_rating: null, count: 0, top_reviews: [] });
    wrap(<LawyersScreen navigation={makeNavigation()} route={{ params: {} }} />);
    await screen.findByText('Ada Counsel');
    expect(screen.getAllByTestId('lawyer-card-book')).toHaveLength(1);
    expect(screen.getAllByTestId('lawyer-card-message')).toHaveLength(1);
  });

  it('scrolling to the end loads page 2 (body is an array; X-Total-Count says when to stop)', async () => {
    const page1 = Array.from({ length: 20 }, (_, i) => ({ ...LAWYERS[0], id: 100 + i, name: `Lawyer ${i}` }));
    const page2 = [{ ...LAWYERS[0], id: 200, name: 'Last Lawyer' }];
    on('get', '/providers/lawyers', (_u: string, { config }: any) => Promise.resolve({
      data: config?.params?.page === 2 ? page2 : page1, headers: { 'x-total-count': '21' } }));
    on('get', '/reviews/summary', { avg_rating: null, count: 0, top_reviews: [] });
    wrap(<LawyersScreen navigation={makeNavigation()} route={{ params: {} }} />);
    expect(await screen.findByTestId('lawyers-total')).toBeTruthy();
    expect(screen.getByText('21 found')).toBeTruthy();
    fireEvent(screen.getByTestId('lawyer-list'), 'onEndReached');
    await waitFor(() => expect(lawyersCall().some((c: any[]) => c[1].params.page === 2)).toBe(true));
    expect(await screen.findByTestId('lawyers-end')).toBeTruthy();       // 21 of 21 loaded → "end of the list"
    expect(screen.getByText(/21 lawyers found/)).toBeTruthy();
    fireEvent(screen.getByTestId('lawyer-list'), 'onEndReached');           // nothing more is requested
    expect(lawyersCall().filter((c: any[]) => c[1].params.page === 3)).toHaveLength(0);
  });

  it('no location permission: says so and searches what the person types (q)', async () => {
    mockGpsFails = true;
    on('get', '/providers/lawyers', LAWYERS);
    on('get', '/reviews/summary', { avg_rating: null, count: 0, top_reviews: [] });
    wrap(<LawyersScreen navigation={makeNavigation()} route={{ params: {} }} />);
    expect(await screen.findByTestId('lawyers-location-off')).toBeTruthy();
    expect(lawyersCall()[0][1].params.lat).toBeUndefined();   // never the Nashville default point
    fireEvent.changeText(screen.getByTestId('lawyers-search-input'), '37219');
    fireEvent.press(screen.getByTestId('lawyers-search-submit'));
    await waitFor(() => expect(lawyersCall().some((c: any[]) => c[1].params.q === '37219')).toBe(true));
  });

  it('an empty filtered result names the filters and offers to clear them', async () => {
    on('get', '/providers/lawyers', (_u: string, { config }: any) => Promise.resolve({ data: config?.params?.language ? [] : LAWYERS }));
    on('get', '/reviews/summary', { avg_rating: null, count: 0, top_reviews: [] });
    wrap(<LawyersScreen navigation={makeNavigation()} route={{ params: {} }} />);
    await screen.findByText('Ada Counsel');
    fireEvent.press(screen.getByTestId('lawyers-filters'));
    fireEvent(screen.getByTestId('filter-language'), 'onValueChange', 'Spanish');
    fireEvent.press(screen.getByTestId('filter-apply'));
    expect(await screen.findByTestId('lawyers-empty')).toBeTruthy();
    expect(screen.getByText(/Spanish/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('lawyers-clear-filters'));
    expect(await screen.findByText('Ada Counsel')).toBeTruthy();
  });

  it('shows the connection-error message when the API fails, with Try again', async () => {
    wrap(<LawyersScreen navigation={makeNavigation()} route={{ params: {} }} />);
    expect(await screen.findByTestId('lawyers-error')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('save posts the listing id, shows saved, and a second tap removes it (synced with /saved/lawyers)', async () => {
    on('get', '/providers/lawyers', LAWYERS);
    on('get', '/reviews/summary', { avg_rating: null, count: 0, top_reviews: [] });
    on('get', '/saved/lawyers', [{ id: 9, provider_id: 2 }]);
    on('post', '/saved/lawyers', { saved: true, id: 77 });
    on('delete', '/saved/lawyers/77', { removed: true });
    wrap(<LawyersScreen navigation={makeNavigation()} route={{ params: {} }} />);
    await screen.findByText('Ada Counsel');
    expect(await screen.findByLabelText('Unsave Ben Barrister')).toBeTruthy();   // already saved elsewhere
    fireEvent.press(screen.getAllByTestId('lawyer-card-save')[0]);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/saved/lawyers', { provider_id: 1 }));
    fireEvent.press(await screen.findByLabelText('Unsave Ada Counsel'));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/saved/lawyers/77'));
    expect(await screen.findByLabelText('Save Ada Counsel to saved list')).toBeTruthy();
  });

  it('the skeleton shimmer never holds InteractionManager (isInteraction:false)', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    on('get', '/providers/lawyers', () => new Promise(() => {}));
    wrap(<LawyersScreen navigation={makeNavigation()} route={{ params: {} }} />);
    await waitFor(() => expect(timing).toHaveBeenCalled());
    expect(timing.mock.calls.every(c => (c[1] as { isInteraction?: boolean }).isInteraction === false)).toBe(true);
    timing.mockRestore();
  });
});

describe('BailSearchScreen', () => {
  it('auto-searches near the user; Call shows the formatted number and dials E.164', async () => {
    const spy = linkSpy();
    on('get', '/providers/bail', [{ ...AGENTS[0], phone: '+16155550100' }]);
    wrap(<BailSearchScreen navigation={makeNavigation()} route={{ params: {} }} />);
    expect(await screen.findByText('Fast Bonds')).toBeTruthy();
    fireEvent.press(screen.getByText('Call (615) 555-0100'));
    expect(spy).toHaveBeenCalledWith('tel:+16155550100');
    expect(bailCall()[0][1].params).toMatchObject({ lat: 36.16, lng: -86.78 });
    expect(bailCall()[0][1].params.radiusKm).toBeUndefined();
    spy.mockRestore();
  });

  it('the 24/7 filter asks the server (open24) instead of filtering on a field the API never sends', async () => {
    on('get', '/providers/bail', (_u: string, { config }: any) => Promise.resolve({ data: config?.params?.open24 ? [] : AGENTS }));
    wrap(<BailSearchScreen navigation={makeNavigation()} route={{ params: {} }} />);
    await screen.findByText('Fast Bonds');
    fireEvent.press(screen.getByTestId('bail-filter-24'));
    expect(await screen.findByTestId('bail-search-empty')).toBeTruthy();
    expect(bailCall().some((c: any[]) => c[1].params.open24 === true)).toBe(true);
  });

  it('shows the empty state when nothing is found', async () => {
    on('get', '/providers/bail', []);
    wrap(<BailSearchScreen navigation={makeNavigation()} route={{ params: {} }} />);
    expect(await screen.findByTestId('bail-search-empty')).toBeTruthy();
  });

  it('GPS denied → says so; the search box searches by what was typed', async () => {
    mockGpsFails = true;
    on('get', '/providers/bail', AGENTS);
    wrap(<BailSearchScreen navigation={makeNavigation()} route={{ params: {} }} />);
    expect(await screen.findByTestId('bail-location-off')).toBeTruthy();
    const input = screen.getByTestId('bail-search-city-input');
    fireEvent.changeText(input, 'Memphis, TN');
    fireEvent(input, 'submitEditing');
    await waitFor(() => expect(bailCall().some((c: any[]) => c[1].params.q === 'Memphis, TN')).toBe(true));
    expect(await screen.findByText('Fast Bonds')).toBeTruthy();
  });

  it('the skeleton shimmer never holds InteractionManager (isInteraction:false)', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    on('get', '/providers/bail', () => new Promise(() => {}));
    wrap(<BailSearchScreen navigation={makeNavigation()} route={{ params: {} }} />);
    await waitFor(() => expect(timing).toHaveBeenCalled());
    expect(timing.mock.calls.every(c => (c[1] as { isInteraction?: boolean }).isInteraction === false)).toBe(true);
    timing.mockRestore();
  });
});
