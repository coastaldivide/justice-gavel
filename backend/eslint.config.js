// ESLint 9 flat config for the Node 22 / Express 5 (ESM) backend.
// Run with `npm run lint` (eslint src scripts --max-warnings 0). CI runs the same.
import js from '@eslint/js';
import globals from 'globals';
import n from 'eslint-plugin-n';
import security from 'eslint-plugin-security';

const sharedRules = {
  // correctness
  'no-undef': 'error',
  'no-unused-vars': ['error', {
    args: 'after-used',
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrors: 'all',
    caughtErrorsIgnorePattern: '^_',
    destructuredArrayIgnorePattern: '^_',
    ignoreRestSiblings: true,
  }],
  'no-unreachable': 'error',
  'no-fallthrough': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-imports': 'error',
  'no-shadow-restricted-names': 'error',
  // An empty block is only allowed when it carries a comment explaining why
  // (applies to catch blocks too).
  'no-empty': ['error', { allowEmptyCatch: false }],
  'require-await': 'error',
  'no-async-promise-executor': 'error',
  'no-promise-executor-return': 'error',

  // style that prevents bugs
  eqeqeq: ['error', 'smart'],
  'no-var': 'error',
  'prefer-const': ['error', { destructuring: 'all' }],

  // Node / ESM
  'n/no-missing-import': 'error',
  'n/no-deprecated-api': 'error',
  'n/no-process-exit': 'off',

  // security (curated: the plugin's object-injection / non-literal-fs rules
  // fire on nearly every bracket access and path.join and are not useful here)
  'security/detect-eval-with-expression': 'error',
  'security/detect-non-literal-require': 'error',
  'security/detect-new-buffer': 'error',
  'security/detect-buffer-noassert': 'error',
  'security/detect-pseudoRandomBytes': 'error',
  'security/detect-disable-mustache-escape': 'error',
  'security/detect-bidi-characters': 'error',
  'security/detect-no-csrf-before-method-override': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
};

export default [
  {
    ignores: ['node_modules/**', 'coverage/**', 'data/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: { n, security },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      ...sharedRules,
      // Runtime code logs through utils/logger.js (pino), never console.
      'no-console': 'error',
    },
  },
  {
    // Offline CLI tools (scrapers, importers, migrations, smoke tests) print to stdout.
    files: ['scripts/**', 'src/scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    // The logger is the one place that writes to the console.
    files: ['src/utils/logger.js'],
    rules: { 'no-console': 'off' },
  },
  {
    // Jest suites: jest globals, console allowed; correctness rules stay on.
    files: ['src/__tests__/**'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      'no-console': 'off',
      'require-await': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-promise-executor-return': 'off',
    },
  },
];
