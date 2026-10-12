const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// EXPO_PUBLIC_* values are inlined into transformed modules, but Metro's
// transform cache key does not include them: exporting once with
// EXPO_PUBLIC_API_BASE=http://localhost:4100/api and then again without it
// silently shipped the localhost URL. Key the cache on those values.
const publicEnv = Object.keys(process.env)
  .filter((k) => k.startsWith('EXPO_PUBLIC_'))
  .sort()
  .map((k) => `${k}=${process.env[k]}`)
  .join('\n');
config.cacheVersion = [
  config.cacheVersion || '',
  require('crypto').createHash('sha1').update(publicEnv).digest('hex'),
].join(':');

// Tree-shake unused modules
config.transformer.minifierConfig = {
  keep_fnames: true,
  mangle: { keep_fnames: true },
};

// NOTE: do not force `inlineRequires: true` here. It defers module side
// effects (e.g. react-native-reanimated's web initializer that defines
// global._WORKLET), which crashed animated components on web. Screens are
// already code-split with React.lazy in AppNavigator.

// Exclude heavy dev-only packages from production bundle
config.resolver.blockList = [
  /.*\/__tests__\/.*/,
  /.*\.test\.(ts|tsx|js)$/,
];

// ── Web: do not bundle react-native-reanimated ────────────────────────────────
// No app code imports reanimated (SkeletonLoader pulses with core Animated).
// It still landed in the web ENTRY bundle (836 KB minified) because
// react-native-gesture-handler's gestures/reanimatedWrapper.js does a guarded
// `try { require('react-native-reanimated') } catch {}`, and Metro bundles any
// statically-visible require. The wrapper is written for reanimated being
// absent (it checks `Reanimated?.useSharedValue` and falls back), so resolving
// the package to an empty module on web is a supported configuration.
// Native platforms are untouched — reanimated stays bundled there.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    platform === 'web' &&
    (moduleName === 'react-native-reanimated' || moduleName.startsWith('react-native-reanimated/'))
  ) {
    return { type: 'empty' };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
