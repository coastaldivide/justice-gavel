// metro.config.js — Metro bundler config with web support
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Web platform resolution — react-native → react-native-web
config.resolver.resolverMainFields = ['react-native', 'browser', 'main'];

// Resolve .web.tsx / .web.ts first so platform-specific files work
config.resolver.sourceExts = [
  'web.tsx', 'web.ts', 'web.jsx', 'web.js',
  ...config.resolver.sourceExts,
];

module.exports = config;
