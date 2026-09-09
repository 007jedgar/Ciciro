module.exports = function (api) {
  api.cache.using(() => require("react-native-worklets/package.json").version);
  return {
    presets: [
      [
        "babel-preset-expo",
        {
          // Injected explicitly below so it always runs last and so a stale
          // api.cache(true) from before worklets was installed cannot skip it.
          worklets: false,
          reanimated: false,
        },
      ],
    ],
    plugins: ["react-native-worklets/plugin"],
  };
};
