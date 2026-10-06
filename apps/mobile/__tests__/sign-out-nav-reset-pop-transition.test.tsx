import React from "react";
import { Pressable, Text } from "react-native";
import { Stack, router } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import type { StackState } from "../lib/stack-back";

// expo-router/testing-library re-mocks reanimated on import with the package's
// own mock, which fails to load here and leaves an empty module. Fill it back
// in from ours (see jest.setup.ts), whose withTiming never calls its completion
// callback, so a held pop stays held.
const ours = jest.requireActual<Record<string, unknown>>("../__mocks__/react-native-reanimated");
Object.defineProperties(
  jest.requireMock<Record<string, unknown>>("react-native-reanimated"),
  Object.getOwnPropertyDescriptors(ours)
);
/* eslint-disable @typescript-eslint/no-require-imports */
const { StackPopTransition } = require("../components/StackPopTransition") as typeof import("../components/StackPopTransition");
const { useStackBack } = require("../lib/use-stack-back") as typeof import("../lib/use-stack-back");
const { appStackState } = require("../lib/stack-back") as typeof import("../lib/stack-back");
const { POP_OVER_STACK_SCREEN_OPTIONS } = require("../lib/stack-pop") as typeof import("../lib/stack-pop");
const { resetLastPlace, restoreLastPlace } = require("../lib/last-place") as typeof import("../lib/last-place");
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * The root stack wrapped in the real `StackPopTransition`, as `app/_layout.tsx`
 * does. Its `beforeRemove` listener holds back GO_BACK / POP / POP_TO /
 * POP_TO_TOP until the collapse animation finishes, and the reanimated mock
 * never finishes one, so every intercepted pop stays pending: the state a
 * `replace()` dispatched right after `dismissAll()` meets on a device.
 */
function SignOutButtons() {
  const { resetTo } = useStackBack();
  return (
    <>
      <Pressable
        testID="sign-out-dismissAll-replace"
        onPress={() => {
          router.dismissAll();
          router.replace("/");
        }}
      >
        <Text>dismissAll+replace</Text>
      </Pressable>
      <Pressable testID="sign-out-resetTo" onPress={() => resetTo("/")}>
        <Text>resetTo</Text>
      </Pressable>
    </>
  );
}

const routes = {
  _layout: () => (
    <Stack
      screenLayout={({ children }) => <StackPopTransition>{children}</StackPopTransition>}
      screenOptions={{ headerShown: false }}
    >
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
  settings: SignOutButtons,
};

function rootRouteNames(app: { getRouterState(): unknown }): string[] {
  const state = appStackState(app.getRouterState() as StackState);
  return state?.routes.map((route) => route.name) ?? [];
}

function signInAndOpenNestedSettings() {
  act(() => restoreLastPlace(router, "user-1"));
  act(() => router.push("/project/p1/chapters"));
  act(() => router.push("/settings"));
}

beforeEach(() => {
  resetLastPlace();
});

describe("sign-out reset under StackPopTransition's pop interception", () => {
  it("reproduces the race: dismissAll's POP_TO_TOP is held for the collapse, so replace only swaps the focused screen", () => {
    const app = renderRouter(routes, { initialUrl: "/" });
    signInAndOpenNestedSettings();
    expect(rootRouteNames(app)).toEqual(["manuscripts", "project/[id]", "settings"]);

    fireEvent.press(screen.getByTestId("sign-out-dismissAll-replace"));

    expect(rootRouteNames(app)).toEqual(["manuscripts", "project/[id]", "index"]);
    expect(router.canGoBack()).toBe(true);
  });

  it("resetTo replaces the whole stack in one step, untouched by the collapse interception", () => {
    const app = renderRouter(routes, { initialUrl: "/" });
    signInAndOpenNestedSettings();

    fireEvent.press(screen.getByTestId("sign-out-resetTo"));

    expect(screen).toHavePathname("/");
    expect(rootRouteNames(app)).toEqual(["index"]);
    expect(router.canGoBack()).toBe(false);
  });
});
