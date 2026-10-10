import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SCRIPT_SETTINGS, serializeScriptSettings, type ScriptSettings } from "@/lib/screenplay";
import { createScriptSettingsSaver } from "@/lib/script-settings-save";

const numbered: ScriptSettings = { ...DEFAULT_SCRIPT_SETTINGS, sceneNumbers: !DEFAULT_SCRIPT_SETTINGS.sceneNumbers };
const noMore: ScriptSettings = { ...DEFAULT_SCRIPT_SETTINGS, more: !DEFAULT_SCRIPT_SETTINGS.more };

type Call = { url: string; init: RequestInit; resolve: (res: Response) => void; reject: (err: unknown) => void };

describe("createScriptSettingsSaver", () => {
  let calls: Call[];
  const onFailed = vi.fn<(stored: string) => void>();

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    onFailed.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (url: string, init: RequestInit) =>
          new Promise<Response>((resolve, reject) => calls.push({ url, init, resolve, reject }))
      )
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const saver = (stored = "") => createScriptSettingsSaver({ projectId: "p1", stored, onFailed });
  const body = (call: Call) => JSON.parse(String(call.init.body)) as { scriptSettings: ScriptSettings };

  it("writes the last change back a moment after it", async () => {
    const s = saver();
    s.schedule(noMore);
    s.schedule(numbered);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(700);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/projects/p1");
    expect(calls[0].init.method).toBe("PATCH");
    expect(body(calls[0]).scriptSettings).toEqual(numbered);
  });

  it("hands back the stored settings when the server refuses the save", async () => {
    const stored = serializeScriptSettings(noMore);
    const s = saver(stored);
    s.schedule(numbered);
    const done = s.flush();
    await vi.advanceTimersByTimeAsync(0);
    calls[0].resolve(new Response("{}", { status: 500 }));
    expect(await done).toBe(false);
    expect(onFailed).toHaveBeenCalledWith(stored);
  });

  it("hands back the last save that landed when the network drops one", async () => {
    const s = saver();
    s.schedule(noMore);
    const first = s.flush();
    await vi.advanceTimersByTimeAsync(0);
    calls[0].resolve(new Response("{}", { status: 200 }));
    expect(await first).toBe(true);
    s.schedule(numbered);
    const second = s.flush();
    await vi.advanceTimersByTimeAsync(0);
    calls[1].reject(new TypeError("offline"));
    expect(await second).toBe(false);
    expect(onFailed).toHaveBeenCalledWith(serializeScriptSettings(noMore));
  });

  it("leaves a newer change alone when an older save fails", async () => {
    const s = saver();
    s.schedule(noMore);
    const first = s.flush();
    await vi.advanceTimersByTimeAsync(0);
    s.schedule(numbered);
    calls[0].resolve(new Response("{}", { status: 500 }));
    expect(await first).toBe(false);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("sends a waiting change at once on flush, so an export reads it", async () => {
    const s = saver();
    s.schedule(numbered);
    const done = s.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    calls[0].resolve(new Response("{}", { status: 200 }));
    expect(await done).toBe(true);
    await vi.advanceTimersByTimeAsync(700);
    expect(calls).toHaveLength(1);
  });

  it("sends with keepalive when the page is going away, even behind a save on its way", async () => {
    const s = saver();
    s.schedule(noMore);
    void s.flush();
    await vi.advanceTimersByTimeAsync(0);
    s.schedule(numbered);
    void s.flush({ keepalive: true });
    expect(calls).toHaveLength(2);
    expect(calls[1].init.keepalive).toBe(true);
    expect(body(calls[1]).scriptSettings).toEqual(numbered);
  });

  it("does nothing on flush when nothing is waiting", async () => {
    expect(await saver().flush()).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
