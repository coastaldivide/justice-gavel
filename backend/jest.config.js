/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['**/__tests__/**/*.test.js'],
  setupFiles: ['./src/__tests__/env.js'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/services/encryption.js',
    'src/services/aiQueue.js',
    'src/services/pushDelivery.js',
    'src/services/contentRefresh.js',
    'src/middleware/auth.js',
    '!src/**/__tests__/**',
  ],
  coverageThreshold: {
    // Realistic thresholds for services + middleware (where tests exist)
    // Route files require integration/E2E tests for coverage — planned for v2
    './src/services/encryption.js': { statements: 85, branches: 75, functions: 75, lines: 85 },
    './src/services/aiQueue.js':    { statements: 50, branches: 40, functions: 40, lines: 50 },
    './src/middleware/auth.js':     { statements: 90, branches: 80, functions: 90, lines: 90 },
  },
  verbose: true,
};
