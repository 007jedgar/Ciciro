import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ListeningSettings } from "../components/ListeningSettings";
import type { ModelState } from "../lib/natural-model";
import { getReadAloudPrefs, resetReadAloudPrefsForTests, setReadAloudPrefs } from "../lib/read-aloud";

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

let mockState: ModelState = { status: "absent" };
jest.mock("../lib/natural-model-store", () => ({
  useNaturalModelState: () => mockState,
  refreshNaturalModel: jest.fn(),
}));

let mockAvailable = true;
let mockCacheBytes = 0;
const mockClearAudio = jest.fn(async () => {});
jest.mock("../lib/natural-engine", () => ({
  naturalNativeAvailable: () => mockAvailable,
  naturalAudioCacheBytes: async () => mockCacheBytes,
  clearNaturalAudioCache: () => mockClearAudio(),
}));

const mockDownload = jest.fn();
const mockPause = jest.fn();
const mockCancel = jest.fn(async () => {});
const mockDelete = jest.fn(async () => {});
jest.mock("../lib/natural-voice-actions", () => ({
  downloadNaturalVoice: (options: unknown) => mockDownload(options),
  pauseNaturalDownload: () => mockPause(),
  cancelNaturalDownload: () => mockCancel(),
  deleteNaturalVoice: () => mockDelete(),
}));

const mockClip = { stop: jest.fn(), resolve: () => {} };
const mockPlayClip = jest.fn((_source: unknown) => ({
  done: new Promise<void>((resolve) => {
    mockClip.resolve = resolve;
  }),
  stop: mockClip.stop,
}));
let mockHasOutput = true;
jest.mock("../lib/natural-audio-output", () => ({
  getNaturalAudioOutput: () => (mockHasOutput ? { playClip: (source: unknown) => mockPlayClip(source) } : null),
}));

jest.mock("expo-speech", () => ({
  getAvailableVoicesAsync: async () => [
    { identifier: "v1", name: "Ava", language: "en-US", quality: "Enhanced" },
    { identifier: "v2", name: "Zoe", language: "en-GB", quality: "Default" },
  ],
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function renderSettings() {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ListeningSettings />
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  resetReadAloudPrefsForTests();
  mockTracked.length = 0;
  mockState = { status: "absent" };
  mockAvailable = true;
  mockHasOutput = true;
  mockCacheBytes = 0;
  jest.clearAllMocks();
  mockDownload.mockResolvedValue("started");
});

describe("Listening settings: the download", () => {
  it("offers the download with its size and Wi-Fi guidance, and the natural voice cannot be chosen yet", async () => {
    renderSettings();
    await act(async () => {});
    expect(screen.getByText("380 MB to download, and the same on your phone once set up.")).toBeTruthy();
    expect(screen.getByText(/Connect to Wi-Fi first/)).toBeTruthy();
    expect(screen.getByTestId("engine-natural").props.accessibilityState).toMatchObject({ disabled: true, selected: false });
    expect(screen.getByTestId("engine-system").props.accessibilityState).toMatchObject({ selected: true });

    fireEvent.press(screen.getByTestId("download-natural"));
    expect(mockDownload).toHaveBeenCalledWith({ allowMetered: false });
  });

  it("asks before downloading over mobile data, and downloads once the writer agrees", async () => {
    mockDownload.mockResolvedValueOnce("needs-confirmation");
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    renderSettings();
    await act(async () => {});
    await act(async () => {
      fireEvent.press(screen.getByTestId("download-natural"));
    });
    expect(alert).toHaveBeenCalledWith(
      "Download on mobile data?",
      "You are not on Wi-Fi, and this download is 380 MB.",
      expect.any(Array)
    );
    const buttons = alert.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    expect(buttons.map((b) => b.text)).toEqual(["Cancel", "Download anyway"]);
    await act(async () => buttons[1].onPress?.());
    expect(mockDownload).toHaveBeenLastCalledWith({ allowMetered: true });
    alert.mockRestore();
  });

  it("shows progress with Pause and Cancel while downloading, and Resume when paused", async () => {
    mockState = { status: "downloading", bytes: 58_000_000, total: 380_076_203 };
    const view = renderSettings();
    await act(async () => {});
    expect(screen.getByTestId("natural-status").props.children).toBe("Downloading… 15%");
    expect(screen.getByText("58 MB of 380 MB")).toBeTruthy();
    fireEvent.press(screen.getByTestId("pause-download"));
    expect(mockPause).toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("cancel-download"));
    expect(mockCancel).toHaveBeenCalled();

    mockState = { status: "paused", bytes: 58_000_000, total: 380_076_203 };
    view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ListeningSettings />
      </SafeAreaProvider>
    );
    expect(screen.getByTestId("natural-status").props.children).toBe("Paused at 15%");
    expect(screen.queryByTestId("pause-download")).toBeNull();
    fireEvent.press(screen.getByTestId("resume-download"));
    expect(mockDownload).toHaveBeenCalledWith({ allowMetered: false });
  });

  it("says it is setting the voice up while installing, with nothing to press", async () => {
    mockState = { status: "installing", progress: 0.5 };
    renderSettings();
    await act(async () => {});
    expect(screen.getByTestId("natural-status").props.children).toBe("Setting up the voice…");
    expect(screen.queryByTestId("pause-download")).toBeNull();
    expect(screen.queryByTestId("cancel-download")).toBeNull();
  });

  it("keeps one ring from downloading through unpacking to ready, and tells a screen reader when it is ready", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
    mockState = { status: "downloading", bytes: 349_000_000, total: 380_076_203 };
    const view = renderSettings();
    await act(async () => {});
    const rerender = (state: ModelState) => {
      mockState = state;
      view.rerender(
        <SafeAreaProvider initialMetrics={METRICS}>
          <ListeningSettings />
        </SafeAreaProvider>
      );
    };
    const ring = () => screen.getByTestId("natural-status").parent;
    const before = ring();
    rerender({ status: "installing", progress: 0.2 });
    expect(screen.getByTestId("natural-status").props.children).toBe("Setting up the voice…");
    expect(announce).not.toHaveBeenCalled();
    rerender({ status: "ready", bytes: 380_076_203 });
    expect(screen.getByTestId("natural-status").props.children).toBe("Ready. Uses 380 MB on this phone.");
    expect(announce).toHaveBeenCalledWith("Ready. Uses 380 MB on this phone.");
    // The status row is the same element throughout, so the ring never remounts and replays.
    expect(ring()).toBe(before);
    announce.mockRestore();
  });

  it("does not announce a voice that was already there when the screen opened", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
    mockState = { status: "ready", bytes: 380_076_203 };
    renderSettings();
    await act(async () => {});
    expect(announce).not.toHaveBeenCalled();
    announce.mockRestore();
  });

  it.each([
    [{ reason: "network" }, "The download was interrupted. Check your connection and try again."],
    [{ reason: "storage", neededBytes: 400_000_000 }, "There is not enough free space. Free up 400 MB and try again."],
    [{ reason: "integrity" }, "The download did not arrive intact. Try again."],
    [{ reason: "install" }, "The voice could not be set up. Try again."],
    [{ reason: "unknown" }, "Something went wrong. Try again."],
  ] as const)("explains a %j failure and offers Try again", async (error, message) => {
    mockState = { status: "error", error, bytes: 0, total: 380_076_203 };
    renderSettings();
    await act(async () => {});
    expect(screen.getByText(message)).toBeTruthy();
    fireEvent.press(screen.getByTestId("download-natural"));
    expect(mockDownload).toHaveBeenCalledWith({ allowMetered: false });
  });

  it("when ready, lets the writer choose the natural voice, and delete it after confirming", async () => {
    mockState = { status: "ready", bytes: 380_076_203 };
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    renderSettings();
    await act(async () => {});
    // Ready and not yet chosen against: the natural voice is what reads.
    expect(screen.getByTestId("engine-natural").props.accessibilityState).toMatchObject({ selected: true, disabled: false });
    expect(screen.getByText("Ready. Uses 380 MB on this phone.")).toBeTruthy();

    fireEvent.press(screen.getByTestId("engine-system"));
    expect(getReadAloudPrefs().engine).toBe("system");
    expect(screen.getByTestId("engine-system").props.accessibilityState).toMatchObject({ selected: true });
    fireEvent.press(screen.getByTestId("engine-natural"));
    expect(getReadAloudPrefs().engine).toBe("natural");
    expect(mockTracked).toEqual([
      ["listening_engine_chosen", { engine: "system" }],
      ["listening_engine_chosen", { engine: "natural" }],
    ]);

    fireEvent.press(screen.getByTestId("delete-natural"));
    expect(alert).toHaveBeenCalledWith("Delete the natural voice?", expect.stringContaining("download it again"), expect.any(Array));
    expect(mockDelete).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] as Array<{ text: string; style?: string; onPress?: () => void }>;
    expect(buttons[1]).toMatchObject({ text: "Delete", style: "destructive" });
    await act(async () => buttons[1].onPress?.());
    expect(mockDelete).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it("shows the system voice as the choice when the model is gone, whatever was chosen before", async () => {
    setReadAloudPrefs({ engine: "natural" });
    renderSettings();
    await act(async () => {});
    expect(screen.getByTestId("engine-system").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId("engine-natural").props.accessibilityState).toMatchObject({ selected: false });
  });

  it("offers no download where this build has no natural voice, and still lists the voices", async () => {
    mockAvailable = false;
    renderSettings();
    await act(async () => {});
    expect(screen.getByText(/need the latest version of Ciciro/)).toBeTruthy();
    expect(screen.queryByTestId("download-natural")).toBeNull();
    expect(screen.queryByText(/Connect to Wi-Fi first/)).toBeNull();
  });
});

describe("Listening settings: voices and samples", () => {
  it("plays a sample before anything is downloaded, one at a time, and stops it again", async () => {
    renderSettings();
    await act(async () => {});
    fireEvent.press(screen.getByTestId("sample-af_heart"));
    expect(mockPlayClip).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Stop the sample of Heart")).toBeTruthy();

    // Another voice replaces it.
    fireEvent.press(screen.getByTestId("sample-bf_emma"));
    expect(mockClip.stop).toHaveBeenCalled();
    expect(mockPlayClip).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Play a sample of Heart")).toBeTruthy();
    expect(screen.getByLabelText("Stop the sample of Emma")).toBeTruthy();

    // The same button stops it.
    fireEvent.press(screen.getByTestId("sample-bf_emma"));
    expect(screen.getByLabelText("Play a sample of Emma")).toBeTruthy();
    expect(mockTracked.filter(([name]) => name === "natural_voice_sample_played")).toEqual([
      ["natural_voice_sample_played", { voice: "af_heart" }],
      ["natural_voice_sample_played", { voice: "bf_emma" }],
    ]);
  });

  it("returns the button to Play when the clip ends by itself, and stops the clip when the screen closes", async () => {
    const view = renderSettings();
    await act(async () => {});
    fireEvent.press(screen.getByTestId("sample-ef_dora"));
    expect(screen.getByLabelText("Stop the sample of Dora")).toBeTruthy();
    await act(async () => mockClip.resolve());
    expect(screen.getByLabelText("Play a sample of Dora")).toBeTruthy();

    fireEvent.press(screen.getByTestId("sample-hf_alpha"));
    mockClip.stop.mockClear();
    view.unmount();
    expect(mockClip.stop).toHaveBeenCalled();
  });

  it("hides the sample buttons where the phone cannot play them", async () => {
    mockHasOutput = false;
    renderSettings();
    await act(async () => {});
    expect(screen.queryByTestId("sample-af_heart")).toBeNull();
    expect(screen.getByTestId("voice-af_heart")).toBeTruthy();
  });

  it("remembers the voice picked for each language, with the default chosen to start", async () => {
    renderSettings();
    await act(async () => {});
    expect(screen.getByTestId("voice-af_heart").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId("voice-bf_emma").props.accessibilityState).toMatchObject({ selected: false });
    fireEvent.press(screen.getByTestId("voice-bf_emma"));
    expect(getReadAloudPrefs().naturalVoices).toEqual({ en: "bf_emma" });
    expect(screen.getByTestId("voice-bf_emma").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId("voice-af_heart").props.accessibilityState).toMatchObject({ selected: false });
    // The Spanish and Hindi picks are separate.
    expect(screen.getByTestId("voice-ef_dora").props.accessibilityState).toMatchObject({ selected: true });
    expect(mockTracked).toEqual([["natural_voice_chosen", { voice: "bf_emma" }]]);
  });

  it("says what the other languages use", async () => {
    renderSettings();
    await act(async () => {});
    expect(screen.getByText(/including Mandarin, are read in the system voice/)).toBeTruthy();
  });
});

describe("Listening settings: the system voice and saved audio", () => {
  it("picks a system voice from the list", async () => {
    renderSettings();
    await act(async () => {});
    fireEvent.press(screen.getByLabelText("Voice, Default"));
    await act(async () => {});
    fireEvent.press(screen.getByLabelText("Ava (en-US)"));
    expect(getReadAloudPrefs().voice).toBe("v1");
    expect(screen.getByLabelText("Voice, Ava")).toBeTruthy();
  });

  it("shows the saved audio and clears it", async () => {
    mockState = { status: "ready", bytes: 380_076_203 };
    mockCacheBytes = 12_400_000;
    renderSettings();
    await act(async () => {});
    expect(screen.getByText("12 MB")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("clear-saved-audio"));
    });
    expect(mockClearAudio).toHaveBeenCalled();
    expect(screen.getByText("0 MB")).toBeTruthy();
  });

  it("has no saved-audio section before there is a voice to save from", async () => {
    renderSettings();
    await act(async () => {});
    expect(screen.queryByTestId("clear-saved-audio")).toBeNull();
  });
});
