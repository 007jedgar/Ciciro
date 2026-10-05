import { act, render, screen } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import ProjectTabsLayout from "../app/project/[id]/(tabs)/_layout";

let mockSegments = ["project", "[id]", "(tabs)", "chapters"];
let mockScreenLayout: ((args: { route: { name: string }; children: ReactNode }) => ReactElement) | undefined;

jest.mock("expo-router", () => {
  const { Text, View } = jest.requireActual("react-native");
  const { useAppHeaderHeight } = jest.requireActual("../components/AppHeader");
  const HeightProbe = ({ name }: { name: string }) => (
    <Text testID={`height-${name}`}>{String(useAppHeaderHeight())}</Text>
  );
  const Tabs = (props: { screenLayout?: typeof mockScreenLayout; children: ReactNode }) => {
    mockScreenLayout = props.screenLayout;
    return (
      <>
        {["chapters", "manuscript", "ciciro"].map((name) => (
          <View key={name}>
            {props.screenLayout
              ? props.screenLayout({ route: { name }, children: <HeightProbe name={name} /> })
              : <HeightProbe name={name} />}
          </View>
        ))}
      </>
    );
  };
  Tabs.Screen = () => null;
  return {
    Redirect: () => null,
    Tabs,
    useLocalSearchParams: () => ({ id: "p1" }),
    useRouter: () => ({ push: jest.fn() }),
    useSegments: () => mockSegments,
  };
});

// The real header measures itself on layout; here a test reports its height.
let mockReportHeight: ((height: number) => void) | undefined;
jest.mock("../components/AppHeader", () => {
  const actual = jest.requireActual("../components/AppHeader");
  return {
    ...actual,
    AppHeader: (props: { onHeightChange?: (height: number) => void }) => {
      mockReportHeight = props.onHeightChange;
      return null;
    },
  };
});
jest.mock("../components/ManuscriptTabBar", () => ({ ManuscriptTabBar: () => null }));
jest.mock("../components/WritingMeter", () => ({ WritingMeter: () => null }));
jest.mock("../components/ManuscriptPaceLabel", () => ({ ManuscriptPaceLabel: () => null }));
jest.mock("../lib/project", () => ({ useProject: () => ({ project: { id: "p1", title: "Book", chapters: [] } }) }));
jest.mock("../lib/session", () => ({ useSession: () => ({ user: { id: "u1" }, ready: true }) }));
jest.mock("../lib/use-stack-back", () => ({ useStackBack: () => ({ backTo: jest.fn() }) }));
jest.mock("../lib/settings", () => ({
  useAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors), settings: { reduceMotion: false } };
  },
}));
jest.mock("../lib/use-reduce-motion", () => ({ useReduceMotion: () => false }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 50, bottom: 0, left: 0, right: 0 }) }));

const heightOf = (name: string) => screen.getByTestId(`height-${name}`).props.children;

// The meter row shows over the manuscript tab only. The chapters tab, off
// screen meanwhile, must keep its own header height, or it slides back in
// padded for the taller header and then jumps up.
describe("project tabs header height", () => {
  it("keeps each tab at the height of the header it shows under", () => {
    const view = render(<ProjectTabsLayout />);
    act(() => mockReportHeight?.(100));
    expect(heightOf("chapters")).toBe("100");

    mockSegments = ["project", "[id]", "(tabs)", "manuscript"];
    view.rerender(<ProjectTabsLayout />);
    act(() => mockReportHeight?.(155));
    expect(heightOf("manuscript")).toBe("155");
    expect(heightOf("chapters")).toBe("100");
    expect(heightOf("ciciro")).toBe("100");

    mockSegments = ["project", "[id]", "(tabs)", "chapters"];
    view.rerender(<ProjectTabsLayout />);
    expect(heightOf("chapters")).toBe("100");
    expect(mockScreenLayout).toBeDefined();
  });
});
