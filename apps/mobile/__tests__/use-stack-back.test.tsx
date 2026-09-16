import React from "react";
import { Pressable, Text } from "react-native";
import { Stack, router, useNavigation } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { useStackBack } from "../lib/use-stack-back";

/** Records how each screen is asked to leave — a pop plays the collapse, a replace does not. */
const leaving: string[] = [];

function Recorder({ children }: { children: React.ReactNode }) {
  const navigation = useNavigation();
  React.useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        leaving.push(event.data.action.type);
      }),
    [navigation]
  );
  return <>{children}</>;
}

function Settings() {
  const { backOr } = useStackBack();
  return (
    <Pressable testID="back" onPress={() => backOr("/manuscripts")}>
      <Text>settings</Text>
    </Pressable>
  );
}

function Project() {
  const { backTo } = useStackBack();
  return (
    <Pressable testID="back" onPress={() => backTo("/manuscripts")}>
      <Text>project</Text>
    </Pressable>
  );
}

const routes = {
  _layout: () => <Stack screenLayout={({ children }) => <Recorder>{children}</Recorder>} />,
  manuscripts: () => <Text>manuscripts</Text>,
  settings: Settings,
  "project/[id]": Project,
};

beforeEach(() => {
  leaving.length = 0;
});

describe("useStackBack", () => {
  it("pops back to the list when it is underneath, so the collapse plays", () => {
    renderRouter(routes, { initialUrl: "/manuscripts" });
    act(() => router.push("/settings"));
    expect(screen).toHavePathname("/settings");

    fireEvent.press(screen.getByTestId("back"));

    expect(screen).toHavePathname("/manuscripts");
    expect(leaving).toEqual(["GO_BACK"]);
  });

  it("pops to the list from a manuscript opened from it", () => {
    renderRouter(routes, { initialUrl: "/manuscripts" });
    act(() => router.push("/project/p1"));
    fireEvent.press(screen.getByTestId("back"));

    expect(screen).toHavePathname("/manuscripts");
    expect(leaving).toEqual(["POP_TO"]);
  });

  it("swaps to the list when the app opened straight onto the manuscript", () => {
    renderRouter(routes, { initialUrl: "/project/p1" });
    fireEvent.press(screen.getByTestId("back"));

    expect(screen).toHavePathname("/manuscripts");
    // A replace, not a pop: there was nothing underneath to reveal.
    expect(leaving).toEqual(["REPLACE"]);
  });
});
