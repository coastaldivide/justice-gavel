/** @type {import('jest').Config} */
module.exports = {
  preset: 'react-native',
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': 'babel-jest',
  },
  testMatch: ['**/src/__tests__/**/*.test.js'],
  moduleNameMapper: {
    '^react-native$': '<rootDir>/src/__tests__/__mocks__/react-native.js',
    '^@react-navigation/.*$': '<rootDir>/src/__tests__/__mocks__/navigation.js',
    '^expo-.*$': '<rootDir>/src/__tests__/__mocks__/expo.js',
    '^@react-native-async-storage/.*$': '<rootDir>/src/__tests__/__mocks__/async-storage.js',
    '^axios$': '<rootDir>/src/__tests__/__mocks__/axios.js',
    '@react-native-community/netinfo': '<rootDir>/src/__tests__/__mocks__/netinfo.js',
    '\\.(png|jpg|svg|ttf)$': '<rootDir>/src/__tests__/__mocks__/file.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@testing-library|expo)/)',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/__tests__/**'],
  verbose: true,
};
