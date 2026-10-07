import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { useEffect, type ReactNode } from "react";
import { StyleSheet, Text } from "react-native";
import type { ReactTestInstance } from "react-test-renderer";
import { MorphRowText, beginRowMorph } from "../components/MorphRowText";
import { StackPopTransition } from "../components/StackPopTransition";
import { useSetScreenOverlay } from "../lib/screen-overlay";
import {
  SharedTitleMorphOverlay,
  SharedTitleMorphProvider,
  useMorphDestStyle,
  useMorphHidden,
  useMorphSourceStyle,
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
  const rowStyle = useMorphSourceStyle(KEY);
  const headerHidden = useMorphHidden(KEY);
  const headerStyle = useMorphDestStyle(KEY);
  return (
    <>
      <Text testID="row" style={rowStyle}>
        row
      </Text>
      <Text testID="header">{headerHidden ? "hidden" : "shown"}</Text>
      <Text testID="headerTitle" style={headerStyle}>
        title
      </Text>
      {actions && state.key ? (
        <SharedTitleMorphOverlay state={state} progress={actions.progress} onReady={actions.overlayReady} />
      ) : null}
    </>
  );
}

function tree(row?: ReactNode) {
  return (
    <SharedTitleMorphProvider>
      {row}
      <Probe />
    </SharedTitleMorphProvider>
  );
}

/** Animated styles recompute only on render under the Reanimated mock. */
const rerender = () => screen.rerender(tree());

function renderProvider(row?: ReactNode) {
  render(tree(row));
  if (row) return;
  act(() => {
    actions!.registerSource(KEY, { text: "My Novel", style: STYLE, measure: async () => FRAME });
  });
}

const rowText = () => (StyleSheet.flatten(screen.getByTestId("row").props.style).opacity === 0 ? "hidden" : "shown");
const DEST = { x: 60, y: 50, width: 200, height: 30 };
const headerText = () => screen.getByTestId("header").props.children;
const headerTitleText = () =>
  StyleSheet.flatten(screen.getByTestId("headerTitle").props.style).opacity === 0 ? "hidden" : "shown";

function overlayFrame(layer: ReactTestInstance): ReactTestInstance {
  let node = layer.parent;
  while (node && StyleSheet.flatten(node.props.style)?.overflow !== "hidden") node = node.parent;
  return node!;
}

async function landForward() {
  await act(() => actions!.beginForward(KEY));
  act(() => {
    actions!.registerDestination(KEY, { text: "My Novel", style: { color: "#111", fontSize: 30 }, frame: DEST });
    actions!.notifyArrived(KEY);
  });
  act(() => jest.advanceTimersByTime(1000));
}

describe("shared-title morph", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("keeps the row's title visible until the travelling title starts moving off it", async () => {
    renderProvider();
    await act(() => actions!.beginForward(KEY));
    expect(headerText()).toBe("hidden");
    expect(rowText()).toBe("shown");

    act(() => {
      actions!.registerDestination(KEY, { text: "My Novel", style: STYLE, frame: DEST });
      actions!.notifyArrived(KEY);
    });
    expect(rowText()).toBe("hidden");
  });

  it("gives the row its title back when the destination never registers", async () => {
    renderProvider();
    await act(() => actions!.beginForward(KEY));
    expect(rowText()).toBe("shown");

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
    while (frameNode && StyleSheet.flatten(frameNode.props.style)?.overflow !== "hidden") frameNode = frameNode.parent;
    expect(StyleSheet.flatten(frameNode?.props.style)).toMatchObject({ left: FRAME.x, top: FRAME.y, width: FRAME.width, height: FRAME.height });
    expect(StyleSheet.flatten(rowLayer.props.style)).toMatchObject({ fontSize: STYLE.fontSize, opacity: 1 });
  });

  it("lays each layer out at its own end's width and size, so the row's layer wraps like the row", async () => {
    renderProvider();
    await act(() => actions!.beginForward(KEY));
    const destStyle = { color: "#111", fontSize: 30 };
    act(() => actions!.registerDestination(KEY, { text: "My Novel", style: destStyle, frame: DEST }));
    const [rowLayer, headerLayer] = screen.getAllByText("My Novel");
    expect(StyleSheet.flatten(rowLayer.props.style)).toMatchObject({ width: FRAME.width, fontSize: STYLE.fontSize });
    expect(StyleSheet.flatten(headerLayer.props.style)).toMatchObject({ width: DEST.width, fontSize: destStyle.fontSize });
  });

  it("breaks the row's layer on the row's own laid-out lines", async () => {
    renderProvider(
      <MorphRowText testID="realRow" morphKey={KEY} morphStyle={STYLE}>
        The Correspondence of Winter Harbor,
      </MorphRowText>
    );
    fireEvent(screen.getByTestId("realRow"), "textLayout", {
      nativeEvent: { lines: [{ text: "The Correspondence of Winter " }, { text: "Harbor," }] },
    });
    let rowNode: ReactTestInstance | null = screen.getByTestId("realRow");
    while (rowNode && !rowNode.instance?.measureInWindow) rowNode = rowNode.parent;
    jest
      .spyOn(rowNode!.instance, "measureInWindow")
      .mockImplementation((cb: (x: number, y: number, w: number, h: number) => void) =>
        cb(FRAME.x, FRAME.y, FRAME.width, FRAME.height)
      );
    await act(() => beginRowMorph(actions, KEY));
    const [rowLayer] = screen.getAllByText("The Correspondence of Winter Harbor,").filter((node) => node.props.testID !== "realRow");
    expect(rowLayer.props.children).toBe("The Correspondence of Winter\nHarbor,");
    expect(StyleSheet.flatten(rowLayer.props.style).width).toBeGreaterThan(FRAME.width);
  });

  it("keeps the header's title up on a pop until the travelling title has laid out over it", async () => {
    renderProvider();
    await landForward();
    expect(headerTitleText()).toBe("shown");

    act(() => actions!.beginBackward(KEY));
    rerender();
    expect(headerTitleText()).toBe("shown");

    const [rowLayer] = screen.getAllByText("My Novel");
    fireEvent(overlayFrame(rowLayer), "layout", { nativeEvent: { layout: DEST } });
    rerender();
    expect(headerTitleText()).toBe("hidden");
    expect(rowText()).toBe("shown");
  });

  it("grows the clipping frame with the scaled-up row layer, so it is never cut mid-word", async () => {
    renderProvider();
    await landForward();
    act(() => actions!.beginBackward(KEY));
    actions!.progress.value = 0.5;
    rerender();
    const frame = StyleSheet.flatten(overlayFrame(screen.getAllByText("My Novel")[0]).props.style);
    // Header 30pt over a row of 18pt: the row's 300pt-wide lines are drawn far wider than the 200pt header.
    expect(frame.width).toBeGreaterThan(FRAME.width);
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
