/**
 * Render tests: LoginScreen + RegisterScreen with a controllable api mock.
 * Covers the happy path (token stored, api called with the identifier/password
 * contract the backend expects), the validation states, and server errors.
 */
import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../constants/theme';
import { ToastProvider } from '../../components/ToastProvider';

jest.mock('../../services/api', () => jest.requireActual<typeof import('./apiMock')>('./apiMock').apiMock().module);
jest.mock('../../services/push', () => ({ __esModule: true, registerForPush: jest.fn(() => Promise.resolve()) }));
const mockSetToken = jest.fn(() => Promise.resolve());
const mockSetItem  = jest.fn(() => Promise.resolve());
jest.mock('../../utils/secureStorage', () => ({
  __esModule: true,
  getToken: jest.fn(() => Promise.resolve(null)),
  setToken: (...a: unknown[]) => mockSetToken(...a),
  setItem:  (...a: unknown[]) => mockSetItem(...a),
  getItem:  jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
  clearAuth: jest.fn(() => Promise.resolve()),
}));

import LoginScreen from '../../screens/LoginScreen';
import RegisterScreen from '../../screens/RegisterScreen';

import { apiMock, makeNavigation } from './apiMock';
const { on, api, reject, reset } = apiMock();

function wrap(node: React.ReactElement) {
  return render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
}

describe('LoginScreen', () => {
  beforeEach(() => { reset(); jest.clearAllMocks(); });

  it('renders its main affordances', () => {
    wrap(<LoginScreen navigation={makeNavigation()} />);
    expect(screen.getByTestId('login-email-input')).toBeTruthy();
    expect(screen.getByTestId('login-password-input')).toBeTruthy();
    expect(screen.getByTestId('login-submit-button')).toBeTruthy();
    expect(screen.getByTestId('login-register-link')).toBeTruthy();
  });

  it('validates empty fields locally without calling the API', async () => {
    wrap(<LoginScreen navigation={makeNavigation()} />);
    fireEvent.press(screen.getByTestId('login-submit-button'));
    expect(await screen.findByText(/Enter your email address or phone number/)).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('login-email-input'), 'user@example.com');
    fireEvent.press(screen.getByTestId('login-submit-button'));
    expect(await screen.findByText(/Enter your password/)).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('submits identifier/password, stores the token and user on success', async () => {
    on('post', '/auth/login', { token: 'jwt-abc', refreshToken: 'r1', user: { id: 7, displayName: 'Dana' } });
    wrap(<LoginScreen navigation={makeNavigation()} />);
    fireEvent.changeText(screen.getByTestId('login-email-input'), '  dana@example.com ');
    fireEvent.changeText(screen.getByTestId('login-password-input'), 'hunter22!');
    fireEvent.press(screen.getByTestId('login-submit-button'));

    await waitFor(() => expect(mockSetToken).toHaveBeenCalledWith('jwt-abc'));
    expect(api.post).toHaveBeenCalledWith('/auth/login', { identifier: 'dana@example.com', password: 'hunter22!' });
    expect(mockSetItem).toHaveBeenCalledWith('user', JSON.stringify({ id: 7, displayName: 'Dana' }));
    expect(screen.queryByTestId('login-error-message')).toBeNull();
  });

  it('shows the server message on 401 and recovers on retry', async () => {
    on('post', '/auth/login', () => Promise.reject(reject(401, { message: 'Invalid credentials. Please check your email/phone and password.' })));
    wrap(<LoginScreen navigation={makeNavigation()} />);
    fireEvent.changeText(screen.getByTestId('login-email-input'), 'dana@example.com');
    fireEvent.changeText(screen.getByTestId('login-password-input'), 'wrong');
    fireEvent.press(screen.getByTestId('login-submit-button'));
    expect(await screen.findByText(/Invalid credentials/)).toBeTruthy();
    expect(mockSetToken).not.toHaveBeenCalled();

    reset();
    on('post', '/auth/login', { token: 'jwt-2', user: { id: 7 } });
    fireEvent.press(screen.getByTestId('login-submit-button'));
    await waitFor(() => expect(mockSetToken).toHaveBeenCalledWith('jwt-2'));
  });
});

describe('RegisterScreen', () => {
  beforeEach(() => { reset(); jest.clearAllMocks(); });

  it('renders inputs and enforces the 8-character password rule locally', async () => {
    wrap(<RegisterScreen navigation={makeNavigation()} />);
    fireEvent.changeText(screen.getByTestId('register-email-input'), 'new@example.com');
    fireEvent.changeText(screen.getByTestId('register-password-input'), 'short');
    fireEvent.press(screen.getByTestId('register-submit-button'));
    expect(await screen.findByText(/at least 8 characters/)).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('normalises a 10-digit US phone to E.164 and registers', async () => {
    on('post', '/auth/register', { token: 'jwt-new', user: { id: 9 } });
    on('post', '/push/d7-reengage', { ok: true });
    wrap(<RegisterScreen navigation={makeNavigation()} />);
    fireEvent.changeText(screen.getByTestId('register-email-input'), '(615) 555-0123');
    fireEvent.changeText(screen.getByTestId('register-password-input'), 'LongEnough9!');
    fireEvent.press(screen.getByTestId('register-submit-button'));

    await waitFor(() => expect(mockSetToken).toHaveBeenCalledWith('jwt-new'));
    expect(api.post).toHaveBeenCalledWith('/auth/register', expect.objectContaining({
      identifier: '+16155550123', password: 'LongEnough9!', isAttorney: false,
    }));
  });

  it('surfaces a duplicate-account error from the server', async () => {
    on('post', '/auth/register', () => Promise.reject(reject(409, { error: 'Email already registered' })));
    wrap(<RegisterScreen navigation={makeNavigation()} />);
    fireEvent.changeText(screen.getByTestId('register-email-input'), 'dupe@example.com');
    fireEvent.changeText(screen.getByTestId('register-password-input'), 'LongEnough9!');
    fireEvent.press(screen.getByTestId('register-submit-button'));
    expect(await screen.findByTestId('register-error-message')).toBeTruthy();
    expect(screen.getByText(/already registered/i)).toBeTruthy();
    expect(mockSetToken).not.toHaveBeenCalled();
  });
});
