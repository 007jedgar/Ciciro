const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

const defaultGetTransformOptions = config.transformer.getTransformOptions;
config.transformer.getTransformOptions = async () => {
  const defaults = (await defaultGetTransformOptions?.()) ?? { transform: {} };
  return {
    ...defaults,
    transform: {
      ...defaults.transform,
      experimentalImportSupport: true,
      // Expo defaults this to false; Worklets' native init requires it.
      // https://docs.swmansion.com/react-native-worklets/docs/guides/troubleshooting/
      inlineRequires: true,
    },
  };
};

module.exports = config;
