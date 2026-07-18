/**
 * Babel config.
 *
 * Reanimated ships a Babel plugin that rewrites worklets so animations can run on the
 * UI thread. It must be listed last, and without it every gesture-driven animation
 * fails at runtime rather than at build time — which is the sort of failure that is
 * very hard to diagnose from a blank screen.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  };
};
