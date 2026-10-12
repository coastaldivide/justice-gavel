/**
 * Render tests: LawyersScreen + BailSearchScreen — results from the mocked
 * api render as cards, the empty and error states show, and one interaction
 * each (saving a lawyer; city fallback search when GPS is denied).
 */
import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  getLocation: jest.fn(() => mockGpsFails
    ? Promise.reject(new Error('denied'))
    : Promise.resolve({ lat: 36.16, lng: -86.78 })),
  getLocationWithCity: jest.fn(() => mockGpsFails
    ? Promise.reject(new Error('denied'))
    : Promise.resolve({ lat: 36.16, lng: -86.78, city: 'Nashville', source: 'gps', permissionGranted: true })),
  detectAndSaveUserState: jest.fn(() => Promise.resolve('TN')),
  formatDistance: (km: number | null) => (km == null ? '' : `${km} km`),
}));
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

describe('LawyersScreen', () => {
  it('first visit shows the "what do you need?" modal instead of fetching', async () => {
    await AsyncStorage.removeItem('lawyers_need_shown');
    wrap(<LawyersScreen navigation={makeNavigation()} route={{ params: {} }} />);
    expect(await screen.findByText('What do you need help with?')).toBeTruthy();
    expect(api.get).not.toHaveBeenCalledWith('/providers/lawyers', expect.anything());
  });

  it('loads lawyers near the user and renders their cards', async () => {
    on('get', '/providers/lawyers', LAWYERS);
    on('get', '/reviews/summary', { avg_rating: 4.5, count: 2, top_reviews: [] });
    wrap(<LawyersScreen navigation={makeNavigation()} route={{ params: {} }} />);
    expect(await screen.findByText('Ada Counsel')).toBeTruthy();
    expect(screen.getByText('Ben Barrister')).toBeTruthy();
    const call = api.get.mock.calls.find((c: any[]) => c[0] === '/providers/lawyers');
    expect(call[1].params).toMatchObject({ lat: 36.16, lng: -86.78 });
  });

  it('shows the empty state when the API returns no lawyers', async () => {
    on('get', '/providers/lawyers', []);
    wrap(<LawyersScreen navigation={makeNavigation()} route={{ params: {} }} />);
    // An empty result sets the status message (which suppresses the list's
    // separate empty block), so this is what the user actually sees.
    expect(await screen.findByText('No lawyers found. Try adjusting filters.')).toBeTruthy();
  });

  it('shows the connection-error message when the API fails', async () => {
    // no handler registered → every request rejects
    wrap(<LawyersScreen navigation={makeNavigation()} route={{ params: {} }} />);
    expect(await screen.findByText(/Could not load lawyers/)).toBeTruthy();
  });

  it('saving a lawyer posts the snapshot to /saved/lawyers', async () => {
    on('get', '/providers/lawyers', LAWYERS);
    on('get', '/reviews/summary', { avg_rating: null, count: 0, top_reviews: [] });
    on('post', '/saved/lawyers', { saved: true, id: 77 });
    wrap(<LawyersScreen navigation={makeNavigation()} route={{ params: {} }} />);
    await screen.findByText('Ada Counsel');

    fireEvent.press(screen.getAllByTestId('lawyer-card-save')[0]);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/saved/lawyers', expect.objectContaining({
      provider_id: 1, name: 'Ada Counsel', phone: '615-555-0001',
    })));
    // star toggles to saved
    expect(await screen.findByLabelText('Unsave Ada Counsel')).toBeTruthy();
  });
});

describe('BailSearchScreen', () => {
  it('auto-searches on mount with GPS and renders agent cards with CALL NOW', async () => {
    on('get', '/providers/bail', AGENTS);
    wrap(<BailSearchScreen navigation={makeNavigation()} route={{ params: {} }} />);
    expect(await screen.findByText('Fast Bonds')).toBeTruthy();
    // "CALL NOW" also appears on the emergency strip, so allow multiple matches.
    expect(screen.getAllByText(/CALL NOW/).length).toBeGreaterThan(0);
    const call = api.get.mock.calls.find((c: any[]) => c[0] === '/providers/bail');
    expect(call[1].params).toMatchObject({ lat: 36.16, lng: -86.78 });
  });

  it('shows the empty state with city suggestions when nothing is nearby', async () => {
    on('get', '/providers/bail', []);
    wrap(<BailSearchScreen navigation={makeNavigation()} route={{ params: {} }} />);
    expect(await screen.findByTestId('bail-search-empty')).toBeTruthy();
    expect(screen.getByText('No bail agents found here.')).toBeTruthy();
  });

  it('GPS denied → city input appears; submitting searches by city', async () => {
    mockGpsFails = true;
    on('get', '/providers/bail', AGENTS);
    wrap(<BailSearchScreen navigation={makeNavigation()} route={{ params: {} }} />);

    const cityInput = await screen.findByTestId('bail-search-city-input');
    fireEvent.changeText(cityInput, 'Memphis');
    fireEvent(cityInput, 'submitEditing');

    expect(await screen.findByText('Fast Bonds')).toBeTruthy();
    const call = api.get.mock.calls.find((c: any[]) => c[0] === '/providers/bail');
    expect(call[1].params).toMatchObject({ city: 'Memphis' });
  });
});
