import { act, render, screen } from "@testing-library/react-native";
import { useEffect, type ReactNode } from "react";
import { StyleSheet, Text } from "react-native";
import type { ReactTestInstance } from "react-test-renderer";
import { StackPopTransition } from "../components/StackPopTransition";
import { useSetScreenOverlay } from "../lib/screen-overlay";
import {
  SharedTitleMorphOverlay,
  SharedTitleMorphProvider,
  useMorphHidden,
  useMorphSourceHidden,
  useSharedTitleMorph,
  useSharedTitleMorphState,
} from "../lib/shared-title-morph";

jest.mock("expo-router", () => ({
  useNavigation: () => ({
    addListener: () => () => {},
    getState: () => ({ routes: [], index: 0 }),
    dispatch: () => {},
  }),
}));

const KEY = "manuscript:p1";
const STYLE = { color: "#000", fontSize: 18 };
const FRAME = { x: 10, y: 200, width: 300, height: 24 };

let actions: ReturnType<typeof useSharedTitleMorph> = null;

function Probe() {
  actions = useSharedTitleMorph();
  const state = useSharedTitleMorphState();
  const rowHidden = useMorphSourceHidden(KEY);
  const headerHidden = useMorphHidden(KEY);
  return (
    <>
      <Text testID="row">{rowHidden ? "hidden" : "shown"}</Text>
      <Text testID="header">{headerHidden ? "hidden" : "shown"}</Text>
      {actions && state.key ? (
        <SharedTitleMorphOverlay state={state} progress={actions.progress} onShown={() => {}} />
      ) : null}
    </>
  );
}

function renderProvider() {
  render(
    <SharedTitleMorphProvider>
      <Probe />
    </SharedTitleMorphProvider>
  );
  act(() => {
    actions!.registerSource(KEY, { text: "My Novel", style: STYLE, measure: async () => FRAME });
  });
}

const rowText = () => screen.getByTestId("row").props.children;
const headerText = () => screen.getByTestId("header").props.children;

describe("shared-title morph", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("keeps the row's title visible until the travelling title is painted over it", async () => {
    renderProvider();
    await act(() => actions!.beginForward(KEY));
    expect(headerText()).toBe("hidden");
    expect(rowText()).toBe("shown");

    act(() => actions!.markOverlayShown(KEY));
    expect(rowText()).toBe("hidden");
  });

  it("gives the row its title back when the destination never registers", async () => {
    renderProvider();
    await act(() => actions!.beginForward(KEY));
    act(() => actions!.markOverlayShown(KEY));
    expect(rowText()).toBe("hidden");

    act(() => jest.advanceTimersByTime(2000));
    expect(rowText()).toBe("shown");
    expect(headerText()).toBe("shown");
  });

  it("does not abandon a morph whose destination registered and arrived", async () => {
    renderProvider();
    await act(() => actions!.beginForward(KEY));
    act(() => {
      actions!.registerDestination(KEY, { text: "My Novel", style: STYLE, frame: { x: 60, y: 50, width: 200, height: 30 } });
      actions!.notifyArrived(KEY);
    });
    act(() => jest.advanceTimersByTime(5000));
    expect(headerText()).toBe("hidden");
  });

  it("carries the row's title, not the header's not-yet-loaded placeholder", async () => {
    renderProvider();
    await act(() => actions!.beginForward(KEY));
    act(() => {
      actions!.registerDestination(KEY, {
        text: "Untitled Manuscript",
        style: STYLE,
        frame: { x: 60, y: 50, width: 200, height: 30 },
      });
    });
    expect(screen.queryByText("Untitled Manuscript")).toBeNull();
    expect(screen.getAllByText("My Novel").length).toBeGreaterThan(0);
  });

  it("lays the travelling title out in the row's frame from its first render", async () => {
    renderProvider();
    await act(() => actions!.beginForward(KEY));
    const [rowLayer] = screen.getAllByText("My Novel");
    let frameNode = rowLayer.parent;
    while (frameNode && StyleSheet.flatten(frameNode.props.style)?.position !== "absolute") frameNode = frameNode.parent;
    expect(StyleSheet.flatten(frameNode?.props.style)).toMatchObject({ left: FRAME.x, top: FRAME.y, width: FRAME.width, height: FRAME.height });
    expect(StyleSheet.flatten(rowLayer.props.style)).toMatchObject({ fontSize: STYLE.fontSize, opacity: 1 });
  });
});

function OverlaySetter({ children }: { children: ReactNode }) {
  const setOverlay = useSetScreenOverlay();
  useEffect(() => {
    setOverlay(children);
    return () => setOverlay(null);
  }, [children, setOverlay]);
  return null;
}

function transformedAncestor(node: ReactTestInstance): ReactTestInstance | null {
  for (let parent = node.parent; parent; parent = parent.parent) {
    const transform = StyleSheet.flatten(parent.props.style)?.transform;
    if (Array.isArray(transform) && transform.length > 0) return parent;
  }
  return null;
}

describe("screen overlay slot", () => {
  it("sits outside the transform of the push a nested, non-entering screen sits inside", () => {
    const overlay = <Text testID="overlay">title</Text>;
    render(
      <StackPopTransition enter>
        <StackPopTransition>
          <OverlaySetter>{overlay}</OverlaySetter>
        </StackPopTransition>
      </StackPopTransition>
    );
    expect(transformedAncestor(screen.getByTestId("overlay"))).toBeNull();
  });
});
