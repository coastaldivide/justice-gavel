/* Render-test environment: mock native modules that have no JS fallback. */
// expo-font's native ExpoFontLoader mock returns undefined from
// getLoadedFonts(), which crashes @expo/vector-icons' isLoaded() check.
jest.mock('expo-font', () => {
  const actual = jest.requireActual('expo-font');
  return {
    ...actual,
    isLoaded: jest.fn(() => true),
    loadAsync: jest.fn(() => Promise.resolve()),
    useFonts: jest.fn(() => [true, null]),
  };
});
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => jest.fn()), fetch: jest.fn(() => Promise.resolve({ isConnected: true })) },
}));
// No backend in tests: every request fails like an unreachable server.
jest.mock('axios', () => {
  const reject = () => Promise.reject(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
  const instance: any = {
    request: jest.fn(reject), get: jest.fn(reject), post: jest.fn(reject), put: jest.fn(reject),
    patch: jest.fn(reject), delete: jest.fn(reject),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    defaults: { headers: { common: {} } },
  };
  return { __esModule: true, default: { create: () => instance, ...instance }, create: () => instance };
});
// FlashList measures its viewport natively and renders no rows under jest;
// swap in FlatList so list content is actually testable.
jest.mock('@shopify/flash-list', () => {
  const React = jest.requireActual('react');
  const { FlatList } = jest.requireActual('react-native');
  const FlashList = React.forwardRef((props: any, ref: any) =>
    React.createElement(FlatList, { ...props, ref }));
  return { __esModule: true, FlashList };
});

// Animated loops keep interaction handles open forever in tests, so
// InteractionManager.runAfterInteractions would never fire mount loaders.
// Run scheduled tasks on the microtask queue instead (the RN-documented mock).
jest.mock('react-native/Libraries/Interaction/InteractionManager', () => {
  const impl = {
    Events: { interactionStart: 'interactionStart', interactionComplete: 'interactionComplete' },
    runAfterInteractions: (task?: () => unknown) => {
      let cancelled = false;
      const promise = Promise.resolve().then(() => { if (!cancelled && task) return task(); });
      return { then: promise.then.bind(promise), done: promise.then.bind(promise), cancel: () => { cancelled = true; } };
    },
    createInteractionHandle: jest.fn(() => 1),
    clearInteractionHandle: jest.fn(),
    setDeadline: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  };
  return { __esModule: true, ...impl, default: impl };
});

jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  const Pass = ({ children }: any) => children;
  return {
    SafeAreaProvider: Pass,
    SafeAreaView: (props: any) => React.createElement(View, props),
    SafeAreaInsetsContext: React.createContext(insets),
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: { insets, frame },
  };
});
