/**
 * Render smoke tests — real React Native renderer via jest-expo (unlike
 * jest.frontend.config.js, which uses a hand-written react-native mock for
 * fast logic tests). Run: npm run test:render
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // First test pays the cold Babel transform of RN + screens (~9s on CI).
  testTimeout: 30000,
  testMatch: ['**/src/__tests__/render/**/*.test.{ts,tsx}'],
  setupFiles: ['<rootDir>/src/__tests__/render/setup.ts'],
  // The logic-test suite keeps hand-written manual mocks of react-native,
  // expo-* etc. in src/__tests__/__mocks__; jest would auto-apply them here.
  modulePathIgnorePatterns: ['<rootDir>/src/__tests__/__mocks__'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@shopify/flash-list|@gorhom/.*))',
  ],
};
