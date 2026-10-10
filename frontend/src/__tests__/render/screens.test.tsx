/**
 * Render smoke tests for key entry screens with the real RN renderer.
 * The API is mocked as unreachable (see setup.ts); screens must render and
 * handle the failure without throwing.
 */
import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../constants/theme';
import { ToastProvider } from '../../components/ToastProvider';
import AgeGateScreen from '../../screens/AgeGateScreen';
import LoginScreen from '../../screens/LoginScreen';
import OfflineStatusScreen from '../../screens/OfflineStatusScreen';
import { usePaymentSheet, PAYMENTS_COMING_SOON, paymentsEnabled } from '../../payments';

const navigation: any = {
  navigate: jest.fn(), goBack: jest.fn(), canGoBack: jest.fn(() => false), setOptions: jest.fn(),
  replace: jest.fn(), reset: jest.fn(), getParent: jest.fn(() => undefined), addListener: jest.fn(() => jest.fn()),
};

function wrap(node: React.ReactElement) {
  return render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
}

describe('render smoke', () => {
  it('AgeGateScreen renders and verifies an adult birth year', async () => {
    const onVerified = jest.fn();
    wrap(<AgeGateScreen onVerified={onVerified} />);
    fireEvent.changeText(screen.getByLabelText('Enter your birth year'), '1990');
    fireEvent.press(screen.getByLabelText('Continue'));
    await waitFor(() => expect(onVerified).toHaveBeenCalled());
  });

  it('AgeGateScreen blocks under-18 users', async () => {
    const onVerified = jest.fn();
    wrap(<AgeGateScreen onVerified={onVerified} />);
    fireEvent.changeText(screen.getByLabelText('Enter your birth year'), String(new Date().getFullYear() - 10));
    fireEvent.press(screen.getByLabelText('Continue'));
    await waitFor(() => expect(onVerified).not.toHaveBeenCalled());
  });

  it('LoginScreen shows a friendly error when the API is unreachable', async () => {
    wrap(<LoginScreen navigation={navigation} />);
    fireEvent.changeText(screen.getByTestId('login-email-input'), 'user@example.com');
    fireEvent.changeText(screen.getByTestId('login-password-input'), 'secret');
    fireEvent(screen.getByTestId('login-password-input'), 'submitEditing');
    expect(await screen.findByText(/Network Error|Login failed/, {}, { timeout: 5000 })).toBeTruthy();
  });

  it('OfflineStatusScreen lists offline tools and navigates', () => {
    wrap(<OfflineStatusScreen navigation={navigation} />);
    fireEvent.press(screen.getByLabelText('Open Know Your Rights Card'));
    expect(navigation.navigate).toHaveBeenCalledWith('RightsCard');
  });

  it('payments layer reports "coming soon" without a Stripe key', async () => {
    expect(paymentsEnabled).toBe(false);
    let api: any;
    function Probe() { api = usePaymentSheet(); return null; }
    render(<Probe />);
    const { error } = await api.presentPaymentSheet();
    expect(error.code).toBe('payments_unavailable');
    expect(error.message).toBe(PAYMENTS_COMING_SOON);
  });
});
