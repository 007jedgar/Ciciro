import { Stack, router } from "expo-router";
import { act, renderRouter } from "expo-router/testing-library";
import { Text } from "react-native";
import { resetLastPlace, rememberPathname, restoreLastPlace } from "../lib/last-place";
import { arrivesSettled } from "../lib/stack-arrival";
import { entersWithStackPush, POP_OVER_STACK_SCREEN_OPTIONS } from "../lib/stack-pop";

// What the root stack decides per route, keyed by route key, from the real
// route objects expo-router hands `screenLayout`.
const slides = new Map<string, { path: string; enter: boolean }>();

function RootLayout() {
  return (
    <Stack
      screenLayout={({ children, options, route }) => {
        const enter = entersWithStackPush(options?.presentation) && !arrivesSettled(route);
        if (!slides.has(route.key)) slides.set(route.key, { path: route.name, enter });
        return children;
      }}
    >
      <Stack.Screen name="manuscripts" />
      <Stack.Screen name="folder/[id]" options={POP_OVER_STACK_SCREEN_OPTIONS} />
      <Stack.Screen name="project/[id]" options={POP_OVER_STACK_SCREEN_OPTIONS} />
      <Stack.Screen name="settings" options={POP_OVER_STACK_SCREEN_OPTIONS} />
    </Stack>
  );
}

const screen = (label: string) => () => <Text>{label}</Text>;

function renderApp() {
  return renderRouter(
    {
      _layout: RootLayout,
      index: screen("index"),
      manuscripts: screen("manuscripts"),
      "folder/[id]": screen("folder"),
      "project/[id]/_layout": () => <Stack screenOptions={{ headerShown: false }} />,
      "project/[id]/(tabs)/_layout": () => <Stack screenOptions={{ headerShown: false }} />,
      "project/[id]/(tabs)/chapters": screen("chapters"),
      "project/[id]/(tabs)/manuscript": screen("manuscript"),
      settings: screen("settings"),
    },
    { initialUrl: "/" }
  );
}

const verdicts = (name: string) => [...slides.values()].filter((s) => s.path === name).map((s) => s.enter);

describe("cold-launch restore through the real router", () => {
  beforeEach(() => {
    slides.clear();
    resetLastPlace();
  });

  it("puts the restored manuscript back without a slide, while screens the author opens still slide", () => {
    rememberPathname("/project/p1/manuscript", "user-1");
    const app = renderApp();
    act(() => restoreLastPlace(router, "user-1"));
    expect(app.getPathname()).toBe("/project/p1/manuscript");
    expect(verdicts("project/[id]")).toEqual([false]);

    act(() => router.push("/settings"));
    expect(verdicts("settings")).toEqual([true]);

    act(() => router.push("/project/p1/chapters"));
    expect(verdicts("project/[id]")).toEqual([false, true]);
  });

  it("puts a restored folder back without a slide", () => {
    rememberPathname("/folder/f1", "user-1");
    renderApp();
    act(() => restoreLastPlace(router, "user-1"));
    expect(verdicts("folder/[id]")).toEqual([false]);

    act(() => router.push("/project/f1/chapters"));
    expect(verdicts("project/[id]")).toEqual([true]);
  });
});
