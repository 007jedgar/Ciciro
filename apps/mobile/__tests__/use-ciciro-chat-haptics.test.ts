import { act, renderHook, waitFor } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { resetWritingTick, setHapticsEnabled } from "../lib/haptics";
import { setSessionToken } from "../lib/session-store";
import { useCiciroChat } from "../lib/use-ciciro-chat";
import { jsonResponse, mockFetch, ndjsonResponse } from "./http";

const mockDisk = new Map<string, string>();
jest.mock("../lib/prefs", () => ({
  getPrefs: () => ({
    getString: (key: string) => mockDisk.get(key),
    set: (key: string, value: string) => {
      mockDisk.set(key, value);
    },
  }),
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy", Soft: "soft" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

async function runTurn(events: string[]) {
  mockFetch(async (_input, init) =>
    (init?.method ?? "GET") === "POST"
      ? ndjsonResponse(events)
      : jsonResponse({ messages: [], runs: [] })
  );
  const { result, unmount } = renderHook(() => useCiciroChat("p1"));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await result.current.send({ projectId: "p1", message: "Hi" });
  });
  unmount();
}

describe("useCiciroChat haptics", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setSessionToken("tok");
    setHapticsEnabled(true);
    resetWritingTick();
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setSessionToken(null);
  });

  it("ticks as a sentence lands and ends with one success", async () => {
    await runTurn([
      '{"type":"turn","id":"t1","runId":"r1"}',
      '{"type":"text","v":"The night"}',
      '{"type":"text","v":" was quiet. "}',
      '{"type":"done","status":"completed","runId":"r1"}',
    ]);
    expect(Haptics.impactAsync).toHaveBeenCalledWith("soft");
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
  });

  it("ticks when the AI writes into the manuscript", async () => {
    await runTurn([
      '{"type":"turn","id":"t1","runId":"r1"}',
      '{"type":"chapter_updated","chapterId":"c1"}',
      '{"type":"done","status":"completed","runId":"r1"}',
    ]);
    expect(Haptics.impactAsync).toHaveBeenCalledWith("soft");
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
  });

  it("gives a single warning, and no success, when the run fails", async () => {
    await runTurn([
      '{"type":"turn","id":"t1","runId":"r1"}',
      '{"type":"done","status":"failed","runId":"r1"}',
    ]);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("warning");
  });

  it("stays silent when haptics are off", async () => {
    setHapticsEnabled(false);
    await runTurn([
      '{"type":"turn","id":"t1","runId":"r1"}',
      '{"type":"text","v":"Done. "}',
      '{"type":"done","status":"completed","runId":"r1"}',
    ]);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });
});
