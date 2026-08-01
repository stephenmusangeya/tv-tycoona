/**
 * Babel config.
 *
 * Deliberately bare: just the Expo preset, no worklets plugin.
 *
 * It used to load `react-native-worklets/plugin` for Reanimated. Nothing in this app
 * ever imported Reanimated — every animation is built on React Native's own `Animated`
 * API — so the plugin was compiling nothing while the dependency it came from was one
 * of the reasons the project could not run in Expo Go.
 *
 * If Reanimated is ever genuinely adopted, its plugin goes back here and must be listed
 * last, or gesture-driven animations fail at runtime rather than at build time.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
