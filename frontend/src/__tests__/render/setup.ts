/* Render-test environment: mock native modules that have no JS fallback. */
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
