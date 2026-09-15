jest.mock("@op-engineering/op-sqlite", () => ({
  open: jest.fn(() => ({
    execute: jest.fn(async () => ({ rows: [] })),
  })),
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

jest.mock("expo-localization", () => ({
  getLocales: jest.fn(() => [{ languageCode: "en", languageTag: "en-US" }]),
}));

// Reanimated's worklet runtime needs the native module, and the package's own
// mock re-enters it. Ours lives in __mocks__/react-native-reanimated.tsx.
jest.mock("react-native-reanimated");

// Skia needs a real canvas. Components under test only care that it renders.
jest.mock("@shopify/react-native-skia", () => {
  const { View } = require("react-native");
  const passthrough = () => null;
  return {
    Canvas: View,
    Group: View,
    Circle: passthrough,
    Path: passthrough,
    Paint: passthrough,
    Blur: passthrough,
    LinearGradient: passthrough,
    SweepGradient: passthrough,
    Skia: { Path: { Make: () => ({}) } },
    vec: (x: number, y: number) => ({ x, y }),
  };
});

// The keyboard is a native surface; the library ships its own mock for it.
jest.mock("react-native-keyboard-controller", () =>
  require("react-native-keyboard-controller/jest")
);

jest.mock("@react-native-community/netinfo", () => ({
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
}));

import i18n from "./lib/i18n";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
