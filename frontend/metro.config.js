const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Tree-shake unused modules
config.transformer.minifierConfig = {
  keep_fnames: true,
  mangle: { keep_fnames: true },
};

// Enable inline requires for faster startup
config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: true,    // ← lazy-loads screens, faster cold start
  },
});

// Exclude heavy dev-only packages from production bundle
config.resolver.blockList = [
  /.*\/__tests__\/.*/,
  /.*\.test\.(ts|tsx|js)$/,
];

module.exports = config;
