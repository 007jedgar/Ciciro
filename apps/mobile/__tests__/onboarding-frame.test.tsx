import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { OnboardingFrame } from "../components/onboarding/OnboardingFrame";

jest.mock("../lib/settings", () => ({
  useAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors), settings: { reduceMotion: true } };
  },
  useOptionalAppTheme: () => ({ settings: { reduceMotion: true } }),
}));
jest.mock("../lib/onboarding-shell", () => ({ useOnboardingChrome: jest.fn() }));
jest.mock("../lib/use-reduce-motion", () => ({ useReduceMotion: () => true }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("expo-linear-gradient", () => {
  const { View } = jest.requireActual("react-native");
  return { LinearGradient: (props: object) => <View testID="footer-fade" {...props} /> };
});
jest.mock("../components/onboarding/WriteInTitle", () => {
  const { Text: Label } = jest.requireActual("react-native");
  return { WriteInTitle: ({ text }: { text: string }) => <Label>{text}</Label> };
});

function frame() {
  return render(
    <OnboardingFrame
      steps={["goal", "obstacle"]}
      step="goal"
      title="Title"
      onBack={jest.fn()}
      onSkip={jest.fn()}
      footer={<Text>Footer</Text>}
    >
      <Text>Row</Text>
    </OnboardingFrame>
  );
}

function scroller() {
  return screen.UNSAFE_getByType(require("react-native").ScrollView);
}

function size(viewport: number, content: number) {
  fireEvent(scroller(), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 320, height: viewport } } });
  act(() => {
    scroller().props.onContentSizeChange(320, content);
  });
}

describe("the footer's edge", () => {
  it("shows nothing between the list and the footer when everything fits", () => {
    frame();
    size(600, 400);
    expect(screen.queryByTestId("footer-fade")).toBeNull();
  });

  it("fades the list out above the footer while more of it is still below", () => {
    frame();
    size(300, 600);
    expect(screen.getByTestId("footer-fade")).toBeTruthy();
  });

  it("lets go of the fade once the list is scrolled to its end", () => {
    frame();
    size(300, 600);
    fireEvent.scroll(scroller(), { nativeEvent: { contentOffset: { x: 0, y: 300 } } });
    expect(screen.queryByTestId("footer-fade")).toBeNull();
  });
});
