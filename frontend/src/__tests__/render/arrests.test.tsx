/**
 * Arrest search UI: an empty result list renders an empty state (no crash),
 * and rows the API flags `is_sample: true` (only sent when the backend runs
 * with SHOW_SAMPLE_ARRESTS=true) carry a visible "Sample record" label.
 */
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../../constants/theme';
import { ToastProvider } from '../../components/ToastProvider';
import FamilyConnectScreen from '../../screens/FamilyConnectScreen';

const mockGet = jest.fn();
jest.mock('../../services/api', () => ({
  __esModule: true,
  api: {
    get: (...a: unknown[]) => mockGet(...a),
    post: jest.fn(() => Promise.reject(new Error('Network Error'))),
    delete: jest.fn(() => Promise.reject(new Error('Network Error'))),
  },
  apiErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

const navigation: any = {
  navigate: jest.fn(), goBack: jest.fn(), canGoBack: jest.fn(() => false), setOptions: jest.fn(),
  replace: jest.fn(), reset: jest.fn(), getParent: jest.fn(() => undefined), addListener: jest.fn(() => jest.fn()),
};

function renderFamilyConnect() {
  return render(
    <ThemeProvider><ToastProvider>
      <FamilyConnectScreen navigation={navigation} route={{ params: {} }} />
    </ToastProvider></ThemeProvider>,
  );
}

async function search(name: string) {
  fireEvent.changeText(screen.getByPlaceholderText('First or last name'), name);
  fireEvent.press(screen.getByLabelText('Search'));
}

describe('arrest search (FamilyConnectScreen)', () => {
  beforeEach(() => mockGet.mockReset());

  it('shows an empty state when the API returns no records', async () => {
    mockGet.mockResolvedValue({ data: { records: [], total: 0 } });
    renderFamilyConnect();
    await search('Nobody');
    expect(await screen.findByTestId('arrest-search-empty')).toBeTruthy();
    expect(screen.getByText('No matching record found')).toBeTruthy();
    expect(screen.queryByTestId('sample-record-badge')).toBeNull();
  });

  it('handles a malformed / missing records field without crashing', async () => {
    mockGet.mockResolvedValue({ data: {} });
    renderFamilyConnect();
    await search('Nobody');
    expect(await screen.findByTestId('arrest-search-empty')).toBeTruthy();
  });

  it('labels sample records and leaves real ones unlabelled', async () => {
    mockGet.mockResolvedValue({ data: { records: [
      { id: 1, name: 'Real Person', county: 'Davidson', state: 'TN', is_sample: false },
      { id: 2, name: 'Demo Person', county: 'Harris', state: 'TX', is_sample: true },
    ], total: 2, sample_mode: true } });
    renderFamilyConnect();
    await search('Person');
    expect(await screen.findByText('Demo Person')).toBeTruthy();
    expect(screen.getAllByTestId('sample-record-badge')).toHaveLength(1);
    expect(screen.getByText('Sample record · not a real arrest')).toBeTruthy();
    expect(screen.queryByTestId('arrest-search-empty')).toBeNull();
  });
});
