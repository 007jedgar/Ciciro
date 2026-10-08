import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Text, View } from "react-native";
import { AppHeader, useMeasuredAppHeaderHeight } from "../components/AppHeader";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 40, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../components/ProgressiveBlur", () => ({ ProgressiveBlur: () => null }));
jest.mock("../lib/settings", () => ({
  useAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, dark: false, layout: makeLayout(colors), settings: { reduceMotion: false } };
  },
}));

function FolderLikeScreen() {
  const [headerHeight, onHeaderHeight] = useMeasuredAppHeaderHeight();
  return (
    <View>
      <AppHeader title="A folder name long enough to wrap onto a second line" floating onHeightChange={onHeaderHeight} />
      <Text testID="content-top">{String(headerHeight)}</Text>
    </View>
  );
}

describe("a screen with its own floating header", () => {
  it("starts with the one-row estimate before the header lays out", () => {
    render(<FolderLikeScreen />);
    expect(screen.getByTestId("content-top")).toHaveTextContent("108");
  });

  it("clears a header whose title wrapped to two lines", () => {
    render(<FolderLikeScreen />);
    const [header] = screen.UNSAFE_root.findAll((node) => typeof node.type === "string" && Boolean(node.props.onLayout));
    act(() => {
      fireEvent(header, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 146 } } });
    });
    expect(screen.getByTestId("content-top")).toHaveTextContent("146");
  });
});
