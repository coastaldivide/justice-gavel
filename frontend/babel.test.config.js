// Babel config for Jest — excludes Reanimated plugin which requires native build
module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [],
    env: {
      test: {
        plugins: [
          // Exclude react-native-reanimated babel plugin in test env
        ],
      },
    },
    overrides: [
      {
        // For test files, use a simpler transform
        test: /\.(test|spec)\.(js|ts|tsx)$/,
        plugins: [],
      },
    ],
  };
};
