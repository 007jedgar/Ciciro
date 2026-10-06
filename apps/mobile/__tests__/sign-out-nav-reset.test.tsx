import React from "react";
import { Pressable, Text } from "react-native";
import { Stack, router } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { useStackBack } from "../lib/use-stack-back";
import { appStackState, type StackState } from "../lib/stack-back";
import { POP_OVER_STACK_SCREEN_OPTIONS } from "../lib/stack-pop";
import { resetLastPlace, rememberPathname, restoreLastPlace } from "../lib/last-place";

/**
 * Settings is reached from inside a manuscript's own tabs (a nested
 * navigator), the same way `app/settings.tsx`'s sign-out button is.
 */
function SignOutButton() {
  const { backTo } = useStackBack();
  return (
    <Pressable testID="sign-out" onPress={() => backTo("/")}>
      <Text>settings</Text>
    </Pressable>
  );
}

const routes = {
  _layout: () => (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="manuscripts" />
      <Stack.Screen name="project/[id]" options={POP_OVER_STACK_SCREEN_OPTIONS} />
      <Stack.Screen name="settings" options={POP_OVER_STACK_SCREEN_OPTIONS} />
    </Stack>
  ),
  index: () => <Text>index</Text>,
  manuscripts: () => <Text>manuscripts</Text>,
  "project/[id]/_layout": () => <Stack screenOptions={{ headerShown: false }} />,
  "project/[id]/(tabs)/_layout": () => <Stack screenOptions={{ headerShown: false }} />,
  "project/[id]/(tabs)/chapters": () => <Text>chapters</Text>,
  settings: SignOutButton,
};

/** The root stack's own route names, unwrapped from expo-router's `__root` wrapper. */
function rootRouteNames(app: { getRouterState(): unknown }): string[] {
  const state = appStackState(app.getRouterState() as StackState);
  return state?.routes.map((route) => route.name) ?? [];
}

function openNestedManuscript() {
  act(() => router.push("/manuscripts"));
  act(() => router.push("/project/p1/chapters"));
  act(() => router.push("/settings"));
}

beforeEach(() => {
  resetLastPlace();
});

describe("sign-out navigation reset", () => {
  it("reproduces the bug: a plain replace leaves the manuscript and its list mounted as modals underneath the welcome screen", () => {
    const app = renderRouter(routes, { initialUrl: "/" });
    openNestedManuscript();

    // What the sign-out button did before the fix.
    act(() => router.replace("/"));

    expect(screen).toHavePathname("/");
    expect(rootRouteNames(app)).toEqual(["index", "manuscripts", "project/[id]", "index"]);
    expect(router.canGoBack()).toBe(true);
  });

  it("fully resets the root stack when signing out from a nested manuscript screen", () => {
    const app = renderRouter(routes, { initialUrl: "/" });
    openNestedManuscript();

    fireEvent.press(screen.getByTestId("sign-out"));

    expect(screen).toHavePathname("/");
    expect(rootRouteNames(app)).toEqual(["index"]);
    expect(router.canGoBack()).toBe(false);
  });

  it("rebuilds a normal back stack on the next sign-in, so back lands on the manuscript list, never a leftover modal", () => {
    const app = renderRouter(routes, { initialUrl: "/" });
    openNestedManuscript();
    fireEvent.press(screen.getByTestId("sign-out"));
    expect(rootRouteNames(app)).toEqual(["index"]);

    rememberPathname("/project/p1/chapters", "user-1");
    act(() => restoreLastPlace(router, "user-1"));

    expect(screen).toHavePathname("/project/p1/chapters");
    expect(rootRouteNames(app)).toEqual(["manuscripts", "project/[id]"]);

    act(() => router.back());
    expect(screen).toHavePathname("/manuscripts");
  });
});
