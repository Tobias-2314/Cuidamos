module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-reanimated/plugin must stay last in this list.
    plugins: ['react-native-reanimated/plugin'],
  };
};
