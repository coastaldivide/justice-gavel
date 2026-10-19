/**
 * permissions.test.tsx — checklist item 43: location and notifications are
 * asked in context, with a reason, never at app start.
 *
 * Before: App.tsx asked for notification permission on launch and on every
 * foreground; Home and Onboarding asked for location on mount; no prompt had
 * an in-app explanation or a "Not now".
 */
import { Alert, Linking } from 'react-native';

const mockLoc = { status: 'undetermined', canAskAgain: true, request: 'granted' };
jest.mock('expo-location', () => ({
  __esModule: true,
  getForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: mockLoc.status, canAskAgain: mockLoc.canAskAgain })),
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: mockLoc.request })),
  getLastKnownPositionAsync: jest.fn(() => Promise.resolve({ coords: { latitude: 36.1, longitude: -86.7 } })),
  getCurrentPositionAsync: jest.fn(() => Promise.resolve({ coords: { latitude: 36.1, longitude: -86.7 } })),
  reverseGeocodeAsync: jest.fn(() => Promise.resolve([{ region: 'Tennessee' }])),
  Accuracy: { Balanced: 3, Lowest: 1, Reduced: 2 },
}));
const mockNotif = { status: 'undetermined', canAskAgain: true, request: 'granted' };
jest.mock('expo-notifications', () => ({
  __esModule: true,
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: mockNotif.status, canAskAgain: mockNotif.canAskAgain })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: mockNotif.request })),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: 'ExponentPushToken[x]' })),
  setNotificationHandler: jest.fn(),
}));
jest.mock('../../services/api', () => ({ __esModule: true, api: { get: jest.fn(() => Promise.reject(new Error('offline'))), post: jest.fn(() => Promise.resolve({ data: {} })) }, default: { post: jest.fn(() => Promise.resolve({ data: {} })) } }));

import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { requestLocationInContext, requestNotificationsInContext, REMINDER_REASON } from '../../services/permissions';
import { getLocation } from '../../services/location';
import { registerForPushNotificationsAsync } from '../../hooks/useAppSetup';

/** Make Alert.alert press the button with this label. */
function answerAlert(label: string | null) {
  return jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    const b = (buttons || []).find(x => x.text === label);
    b?.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockLoc, { status: 'undetermined', canAskAgain: true, request: 'granted' });
  Object.assign(mockNotif, { status: 'undetermined', canAskAgain: true, request: 'granted' });
});

describe('location', () => {
  it('already granted → no dialog at all', async () => {
    mockLoc.status = 'granted';
    const spy = answerAlert(null);
    expect(await requestLocationInContext()).toBe('granted');
    expect(spy).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('first ask: our explainer with the reason; "Not now" never triggers the system prompt', async () => {
    const spy = answerAlert('Not now');
    expect(await requestLocationInContext('Find lawyers near you.')).toBe('declined');
    expect(spy.mock.calls[0][1]).toBe('Find lawyers near you.');
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('agreeing shows the system prompt', async () => {
    answerAlert('Use my location');
    expect(await requestLocationInContext()).toBe('granted');
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('denied for good → offers Settings instead of a dead prompt', async () => {
    Object.assign(mockLoc, { status: 'denied', canAskAgain: false });
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined as never);
    answerAlert('Open Settings');
    expect(await requestLocationInContext()).toBe('denied');
    expect(open).toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('passive use (Home widgets) never prompts', async () => {
    const spy = answerAlert('Use my location');
    await expect(getLocation({ prompt: false })).rejects.toThrow(/denied/);
    expect(spy).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('notifications', () => {
  it('app start / foreground never prompts', async () => {
    await registerForPushNotificationsAsync();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('in context (court date saved): explainer with the reminder reason, then the system prompt', async () => {
    const spy = answerAlert('Turn on reminders');
    expect(await requestNotificationsInContext()).toBe('granted');
    expect(spy.mock.calls[0][1]).toBe(REMINDER_REASON());
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('"Not now" leaves it for later without asking the OS', async () => {
    answerAlert('Not now');
    expect(await requestNotificationsInContext()).toBe('declined');
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});
