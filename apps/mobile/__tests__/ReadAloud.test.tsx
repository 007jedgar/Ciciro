import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ReadAloud } from "../components/ReadAloud";
import type { SpeechEngine } from "../lib/read-aloud";

jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: View };
});

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function renderWithInsets(ui: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

jest.mock("../lib/settings", () => ({
  useAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors) };
  },
  useOptionalAppTheme: () => null,
}));

function fakeEngine() {
  const calls: Array<{ text: string; rate: number; voice?: string; onDone: () => void }> = [];
  const engine: SpeechEngine = {
    speak: (text, options) => {
      calls.push({ text, ...options });
    },
    stop: jest.fn(),
  };
  return { engine, calls };
}

const html = "<p>One. Two.</p><p>Three.</p>";

describe("ReadAloud", () => {
  it("plays, highlights the sentence being read, and stops", async () => {
    const { engine, calls } = fakeEngine();
    renderWithInsets(
      <ReadAloud chapterId="c1" html={html} selection={null} engine={engine} loadVoiceList={async () => []} />
    );
    await act(async () => {});
    fireEvent.press(screen.getByLabelText("Play"));
    expect(calls[0].text).toBe("One.");
    expect(screen.getByTestId("reading-sentence").props.children).toBe("One.");
    act(() => calls[0].onDone());
    expect(calls[1].text).toBe("Two.");
    expect(screen.getByTestId("reading-sentence").props.children).toBe("Two.");
    fireEvent.press(screen.getByLabelText("Pause"));
    expect(screen.getByLabelText("Resume")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Stop"));
    expect(screen.queryByTestId("reading-sentence")).toBeNull();
  });

  it("reads only the selection when there is one", async () => {
    const { engine, calls } = fakeEngine();
    const plain = "One. Two.\nThree.";
    renderWithInsets(
      <ReadAloud
        chapterId="c1"
        html={html}
        selection={{ start: plain.indexOf("Three"), end: plain.length }}
        engine={engine}
        loadVoiceList={async () => []}
      />
    );
    await act(async () => {});
    fireEvent.press(screen.getByLabelText("Play"));
    expect(calls.map((c) => c.text)).toEqual(["Three."]);
  });

  it("changes speed and voice", async () => {
    const { engine, calls } = fakeEngine();
    renderWithInsets(
      <ReadAloud
        chapterId="c1"
        html={html}
        selection={null}
        engine={engine}
        loadVoiceList={async () => [{ identifier: "v1", name: "Ava", language: "en-US" }]}
      />
    );
    await act(async () => {});
    fireEvent.press(screen.getByLabelText("Play"));
    fireEvent.press(screen.getByLabelText("Speed: 1x"));
    expect(calls[calls.length - 1]).toMatchObject({ text: "One.", rate: 1.25 });
    fireEvent.press(screen.getByLabelText("Voice: Default"));
    fireEvent.press(screen.getByLabelText("Ava (en-US)"));
    expect(calls[calls.length - 1]).toMatchObject({ voice: "v1" });
    expect(screen.getByLabelText("Voice: Ava")).toBeTruthy();
  });

  it("keeps Play and Stop outside the scrolling text, so they stay reachable", async () => {
    const { engine } = fakeEngine();
    const { UNSAFE_getAllByType } = renderWithInsets(
      <ReadAloud chapterId="c1" html={html} selection={null} engine={engine} loadVoiceList={async () => []} />
    );
    await act(async () => {});
    const { ScrollView } = require("react-native");
    const scrolls = UNSAFE_getAllByType(ScrollView);
    expect(scrolls).toHaveLength(1);
    expect(scrolls[0].findAllByProps({ accessibilityLabel: "Play" })).toHaveLength(0);
    expect(screen.getByLabelText("Play")).toBeTruthy();
    expect(scrolls[0].findByProps({ children: "Three." })).toBeTruthy();
  });
});
