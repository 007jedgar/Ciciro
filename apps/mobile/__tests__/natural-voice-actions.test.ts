import type { ModelState } from "../lib/natural-model";
import { getReadAloudPrefs, resetReadAloudPrefsForTests, setReadAloudPrefs } from "../lib/read-aloud";

const mockTracked: Array<[string, unknown]> = [];
jest.mock("../lib/analytics-client", () => ({
  getAnalytics: () => ({ track: (name: string, props: unknown) => mockTracked.push([name, props]) }),
}));

const mockOrder: string[] = [];
const mockInstaller = {
  current: { status: "absent" } as ModelState,
  start: jest.fn(async () => {}),
  pause: jest.fn(),
  cancel: jest.fn(async () => {
    mockOrder.push("cancel");
  }),
  delete: jest.fn(async () => {
    mockOrder.push("delete-model");
  }),
};
let mockHasInstaller = true;
jest.mock("../lib/natural-model-store", () => ({
  getNaturalInstaller: () => (mockHasInstaller ? mockInstaller : null),
}));

let mockNative = true;
jest.mock("../lib/natural-engine", () => ({
  naturalNativeAvailable: () => mockNative,
  disposeNaturalEngine: async () => {
    mockOrder.push("dispose-engine");
  },
  clearNaturalAudioCache: async () => {
    mockOrder.push("clear-audio");
  },
}));

let mockNetwork: { type: string; details: unknown } = { type: "wifi", details: {} };
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { fetch: async () => mockNetwork },
}));

import {
  cancelNaturalDownload,
  deleteNaturalVoice,
  downloadNaturalVoice,
  onMeteredConnection,
  pauseNaturalDownload,
} from "../lib/natural-voice-actions";

beforeEach(() => {
  mockTracked.length = 0;
  mockOrder.length = 0;
  mockHasInstaller = true;
  mockNative = true;
  mockNetwork = { type: "wifi", details: {} };
  mockInstaller.current = { status: "absent" };
  jest.clearAllMocks();
  resetReadAloudPrefsForTests();
});

describe("onMeteredConnection", () => {
  it("is true on mobile data and on a connection the OS calls expensive", async () => {
    mockNetwork = { type: "cellular", details: {} };
    expect(await onMeteredConnection()).toBe(true);
    mockNetwork = { type: "wifi", details: { isConnectionExpensive: true } };
    expect(await onMeteredConnection()).toBe(true);
  });

  it("is false on ordinary Wi-Fi, and when the connection cannot be read", async () => {
    expect(await onMeteredConnection()).toBe(false);
    mockNetwork = null as never;
    expect(await onMeteredConnection()).toBe(false);
  });
});

describe("downloadNaturalVoice", () => {
  it("starts the download on Wi-Fi and records it, then records how it ended", async () => {
    let finish = () => {};
    mockInstaller.start.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    expect(await downloadNaturalVoice({ allowMetered: false })).toBe("started");
    expect(mockInstaller.start).toHaveBeenCalledTimes(1);
    expect(mockTracked[0]).toEqual(["natural_voice_download_started", { resumed: false, cellular: false }]);
    mockInstaller.current = { status: "ready", bytes: 1 };
    finish();
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockTracked[1][0]).toBe("natural_voice_download_completed");
    expect(mockTracked[1][1]).toMatchObject({ resumed: false });
  });

  it("asks first on mobile data, and goes ahead once allowed", async () => {
    mockNetwork = { type: "cellular", details: {} };
    expect(await downloadNaturalVoice({ allowMetered: false })).toBe("needs-confirmation");
    expect(mockInstaller.start).not.toHaveBeenCalled();
    expect(mockTracked).toEqual([]);
    expect(await downloadNaturalVoice({ allowMetered: true })).toBe("started");
    expect(mockTracked[0]).toEqual(["natural_voice_download_started", { resumed: false, cellular: true }]);
  });

  it("records a resumed download as resumed", async () => {
    mockInstaller.current = { status: "paused", bytes: 10, total: 100 };
    await downloadNaturalVoice({ allowMetered: false });
    expect(mockTracked[0]).toEqual(["natural_voice_download_started", { resumed: true, cellular: false }]);
  });

  it("records why a download failed, and nothing else about it", async () => {
    let finish = () => {};
    mockInstaller.start.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    await downloadNaturalVoice({ allowMetered: false });
    mockInstaller.current = { status: "error", error: { reason: "storage", neededBytes: 5 }, bytes: 0, total: 1 };
    finish();
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockTracked[1]).toEqual(["natural_voice_download_failed", { reason: "storage" }]);
  });

  it("does nothing where the natural voice cannot run", async () => {
    mockNative = false;
    expect(await downloadNaturalVoice({ allowMetered: true })).toBe("unavailable");
    mockNative = true;
    mockHasInstaller = false;
    expect(await downloadNaturalVoice({ allowMetered: true })).toBe("unavailable");
    expect(mockInstaller.start).not.toHaveBeenCalled();
  });
});

describe("pause, cancel and delete", () => {
  it("pauses the installer", () => {
    pauseNaturalDownload();
    expect(mockInstaller.pause).toHaveBeenCalled();
  });

  it("records a cancelled download", async () => {
    await cancelNaturalDownload();
    expect(mockInstaller.cancel).toHaveBeenCalled();
    expect(mockTracked).toEqual([["natural_voice_download_canceled", {}]]);
  });

  it("deletes the voice: stops the engine first, then the model, then the audio made with it", async () => {
    await deleteNaturalVoice();
    expect(mockOrder).toEqual(["dispose-engine", "delete-model", "clear-audio"]);
    expect(mockTracked).toEqual([["natural_voice_deleted", {}]]);
  });

  it("forgets an earlier natural choice with the voice, but keeps a choice of the system voice", async () => {
    setReadAloudPrefs({ engine: "natural" });
    await deleteNaturalVoice();
    expect(getReadAloudPrefs().engine).toBeNull();

    setReadAloudPrefs({ engine: "system" });
    await deleteNaturalVoice();
    expect(getReadAloudPrefs().engine).toBe("system");
  });
});
