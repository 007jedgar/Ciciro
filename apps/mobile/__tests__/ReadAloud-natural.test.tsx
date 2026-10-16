import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ReadAloud } from "../components/ReadAloud";
import { resetReadAloudPrefsForTests, setReadAloudPrefs, type SpeechRun } from "../lib/read-aloud";
import type { EngineEvent } from "../lib/kokoro-engine";

jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: View };
});

jest.mock("../lib/settings", () => ({
  useAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors) };
  },
  useOptionalAppTheme: () => null,
}));

const mockTracked: Array<[string, unknown]> = [];
jest.mock("../lib/analytics-client", () => ({
  getAnalytics: () => ({ track: (name: string, props: unknown) => mockTracked.push([name, props]) }),
}));

const mockSpeak = jest.fn();
const mockStopSpeech = jest.fn();
jest.mock("expo-speech", () => ({
  speak: (...args: unknown[]) => mockSpeak(...args),
  stop: () => mockStopSpeech(),
  getAvailableVoicesAsync: async () => [],
}));

let mockModelStatus: "ready" | "absent" = "ready";
jest.mock("../lib/natural-model-store", () => ({
  useNaturalModelState: () => (mockModelStatus === "ready" ? { status: "ready", bytes: 1 } : { status: "absent" }),
  naturalModelState: () => (mockModelStatus === "ready" ? { status: "ready", bytes: 1 } : { status: "absent" }),
}));

let mockEngineListener: ((event: EngineEvent) => void) | null = null;
const naturalRun: { current: SpeechRun | null } = { current: null };
const mockNaturalEngine = {
  playRun: jest.fn((run: SpeechRun) => {
    naturalRun.current = run;
  }),
  speak: jest.fn(),
  stop: jest.fn(),
  dispose: jest.fn(),
};
jest.mock("../lib/natural-engine", () => ({
  getNaturalEngine: () => mockNaturalEngine,
  naturalNativeAvailable: () => true,
  onNaturalEngineEvent: (listener: (event: EngineEvent) => void) => {
    mockEngineListener = listener;
    return () => {
      mockEngineListener = null;
    };
  },
}));

const commandHandlers = new Set<(command: "play" | "pause" | "stop") => void>();
const mockNowPlaying = {
  show: jest.fn(),
  hide: jest.fn(),
  onCommand: (handler: (command: "play" | "pause" | "stop") => void) => {
    commandHandlers.add(handler);
    return () => commandHandlers.delete(handler);
  },
};
jest.mock("../lib/natural-audio-output", () => ({
  getNaturalAudioOutput: () => ({ nowPlaying: mockNowPlaying }),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function renderReader(ui: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const english = "<p>The ferry left at dawn. Nobody on the quay said a word. The sea was flat and grey.</p>";
const spanish = "<p>El barco salió al amanecer. Nadie en el muelle dijo una palabra. El mar estaba en calma.</p>";

beforeEach(() => {
  resetReadAloudPrefsForTests();
  mockTracked.length = 0;
  mockModelStatus = "ready";
  naturalRun.current = null;
  commandHandlers.clear();
  jest.clearAllMocks();
});

describe("ReadAloud with the natural voice", () => {
  it("hands the whole read to the natural engine with the voice for the chapter's language", async () => {
    renderReader(<ReadAloud chapterId="c1" html={english} selection={null} loadVoiceList={async () => []} />);
    await act(async () => {});
    fireEvent.press(screen.getByLabelText("Play"));
    expect(mockSpeak).not.toHaveBeenCalled();
    expect(naturalRun.current).toMatchObject({ voice: "af_heart", from: 0, rate: 1 });
    expect(naturalRun.current?.texts).toHaveLength(3);
    act(() => naturalRun.current?.onSentence(1));
    expect(screen.getByTestId("reading-sentence").props.children).toBe("Nobody on the quay said a word.");
  });

  it("uses the voice the writer picked, and the Spanish voice for Spanish text", async () => {
    setReadAloudPrefs({ naturalVoices: { en: "bf_emma" } });
    const first = renderReader(<ReadAloud chapterId="c1" html={english} selection={null} loadVoiceList={async () => []} />);
    await act(async () => {});
    fireEvent.press(screen.getByLabelText("Play"));
    expect(naturalRun.current?.voice).toBe("bf_emma");
    first.unmount();

    renderReader(<ReadAloud chapterId="c2" html={spanish} selection={null} loadVoiceList={async () => []} />);
    await act(async () => {});
    fireEvent.press(screen.getByLabelText("Play"));
    expect(naturalRun.current?.voice).toBe("ef_dora");
  });

  it("reads with the system voice when the model is not downloaded, or the writer chose it", async () => {
    mockModelStatus = "absent";
    const first = renderReader(<ReadAloud chapterId="c1" html={english} selection={null} loadVoiceList={async () => []} />);
    await act(async () => {});
    fireEvent.press(screen.getByLabelText("Play"));
    expect(mockNaturalEngine.playRun).not.toHaveBeenCalled();
    expect(mockSpeak).toHaveBeenCalledWith("The ferry left at dawn.", expect.anything());
    first.unmount();

    mockModelStatus = "ready";
    mockSpeak.mockClear();
    setReadAloudPrefs({ engine: "system" });
    renderReader(<ReadAloud chapterId="c2" html={english} selection={null} loadVoiceList={async () => []} />);
    await act(async () => {});
    fireEvent.press(screen.getByLabelText("Play"));
    expect(mockNaturalEngine.playRun).not.toHaveBeenCalled();
    expect(mockSpeak).toHaveBeenCalledTimes(1);
  });

  it("falls back to the system voice from the sentence the natural voice stopped at, and says so", async () => {
    renderReader(<ReadAloud chapterId="c1" html={english} selection={null} loadVoiceList={async () => []} />);
    await act(async () => {});
    fireEvent.press(screen.getByLabelText("Play"));
    act(() => naturalRun.current?.onSentence(1));
    act(() => naturalRun.current?.onError({ reason: "too-slow", index: 2 }));
    expect(mockSpeak).toHaveBeenCalledWith("The sea was flat and grey.", expect.anything());
    expect(screen.getByTestId("read-aloud-fell-back")).toBeTruthy();
    expect(screen.getByText(/system voice is reading instead/)).toBeTruthy();
    expect(mockNowPlaying.hide).toHaveBeenCalled();
    // The notice belongs to that read.
    fireEvent.press(screen.getByLabelText("Stop"));
    expect(screen.queryByTestId("read-aloud-fell-back")).toBeNull();
  });

  it("says the voice is preparing while nothing is audible yet", async () => {
    renderReader(<ReadAloud chapterId="c1" html={english} selection={null} loadVoiceList={async () => []} />);
    await act(async () => {});
    fireEvent.press(screen.getByLabelText("Play"));
    act(() => naturalRun.current?.onBuffering?.(true));
    expect(screen.getByText("Preparing the voice…")).toBeTruthy();
    act(() => naturalRun.current?.onBuffering?.(false));
    expect(screen.queryByText("Preparing the voice…")).toBeNull();
  });

  it("shows the lock-screen card while it reads, follows its Pause and Play, and takes it down on Stop", async () => {
    renderReader(
      <ReadAloud
        chapterId="c1"
        html={english}
        selection={null}
        chapterTitle="Chapter 1"
        manuscriptTitle="The Quay"
        loadVoiceList={async () => []}
      />
    );
    await act(async () => {});
    fireEvent.press(screen.getByLabelText("Play"));
    expect(mockNowPlaying.show).toHaveBeenLastCalledWith({ title: "Chapter 1", artist: "The Quay" }, "playing");

    act(() => commandHandlers.forEach((h) => h("pause")));
    expect(screen.getByLabelText("Resume")).toBeTruthy();
    expect(mockNowPlaying.show).toHaveBeenLastCalledWith({ title: "Chapter 1", artist: "The Quay" }, "paused");

    act(() => commandHandlers.forEach((h) => h("play")));
    expect(screen.getByLabelText("Pause")).toBeTruthy();

    act(() => commandHandlers.forEach((h) => h("stop")));
    expect(screen.getByLabelText("Play")).toBeTruthy();
    expect(mockNowPlaying.hide).toHaveBeenCalled();
  });

  it("ignores the lock screen when the phone's own voice is reading", async () => {
    mockModelStatus = "absent";
    renderReader(<ReadAloud chapterId="c1" html={english} selection={null} loadVoiceList={async () => []} />);
    await act(async () => {});
    fireEvent.press(screen.getByLabelText("Play"));
    expect(mockNowPlaying.show).not.toHaveBeenCalled();
    act(() => commandHandlers.forEach((h) => h("pause")));
    expect(screen.getByLabelText("Pause")).toBeTruthy();
  });

  it("records how a natural read went, and when the voice gave up, without any text", async () => {
    renderReader(<ReadAloud chapterId="c1" html={english} selection={null} loadVoiceList={async () => []} />);
    await act(async () => {});
    act(() =>
      mockEngineListener?.({ type: "run-finished", outcome: "stopped", synthesized: 3, cached: 0, underruns: 0, rtf: 0.456, firstAudioMs: 812.4 })
    );
    act(() => mockEngineListener?.({ type: "gave-up", reason: "too-slow", why: "rtf" }));
    // A read served wholly from saved audio has no speed to report.
    act(() =>
      mockEngineListener?.({ type: "run-finished", outcome: "completed", synthesized: 0, cached: 3, underruns: 0, rtf: null, firstAudioMs: null })
    );
    expect(mockTracked).toEqual([
      ["natural_voice_read_finished", { outcome: "stopped", firstAudioMs: 812, rtf: 0.46, underruns: 0, synthesized: 3, cached: 0 }],
      ["natural_voice_fallback", { reason: "too-slow", why: "rtf" }],
    ]);
  });

  it("records a natural read stopped before its first sentence was heard, with no speed", async () => {
    renderReader(<ReadAloud chapterId="c1" html={english} selection={null} loadVoiceList={async () => []} />);
    await act(async () => {});
    act(() =>
      mockEngineListener?.({ type: "run-finished", outcome: "stopped", synthesized: 0, cached: 0, underruns: 0, rtf: null, firstAudioMs: null })
    );
    expect(mockTracked).toEqual([
      ["natural_voice_read_finished", { outcome: "stopped", firstAudioMs: null, rtf: null, underruns: 0, synthesized: 0, cached: 0 }],
    ]);
  });
});
