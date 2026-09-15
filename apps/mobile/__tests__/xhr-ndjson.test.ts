import { readNdjsonViaXhr, shouldUseXhrNdjson } from "../lib/api/xhr-ndjson";
import { StallError } from "../lib/api/ndjson";

describe("readNdjsonViaXhr", () => {
  const OriginalXHR = globalThis.XMLHttpRequest;

  afterEach(() => {
    globalThis.XMLHttpRequest = OriginalXHR;
  });

  it("is disabled under Jest so unit tests keep using fetch", () => {
    expect(shouldUseXhrNdjson()).toBe(false);
  });

  it("parses NDJSON from XHR responseText as it grows", async () => {
    class FakeXHR {
      status = 200;
      responseText = "";
      onprogress: (() => void) | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      abort() {}
      getResponseHeader(name: string) {
        return name.toLowerCase() === "x-ciciro-session" ? "tok" : null;
      }
      send() {
        queueMicrotask(() => {
          this.responseText = '{"type":"text","v":"Hel"}\n';
          this.onprogress?.();
          this.responseText += '{"type":"done","status":"completed"}\n';
          this.onload?.();
        });
      }
    }
    globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;

    const events: unknown[] = [];
    const result = await readNdjsonViaXhr("https://ciciro.app/api/chat", {
      headers: new Headers({ "content-type": "application/json" }),
      body: "{}",
      onEvent: (event) => events.push(event),
    });
    expect(result.status).toBe(200);
    expect(result.header("x-ciciro-session")).toBe("tok");
    expect(events).toEqual([
      { type: "text", v: "Hel" },
      { type: "done", status: "completed" },
    ]);
  });

  it("gives up on a stream that stops sending without closing", async () => {
    jest.useFakeTimers();
    const aborted = jest.fn();
    class HangingXHR {
      status = 200;
      responseText = "";
      onprogress: (() => void) | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      getResponseHeader() {
        return null;
      }
      abort() {
        aborted();
        this.onabort?.();
      }
      send() {
        // One chunk arrives, then the connection is held open forever.
        this.responseText = '{"type":"text","v":"Hel"}\n';
        this.onprogress?.();
      }
    }
    globalThis.XMLHttpRequest = HangingXHR as unknown as typeof XMLHttpRequest;

    const events: unknown[] = [];
    const pending = readNdjsonViaXhr("https://ciciro.app/api/chat", {
      headers: new Headers(),
      body: "{}",
      stallMs: 1_000,
      onEvent: (event) => events.push(event),
    }).catch((error: unknown) => error);

    // The chunk restarted the clock, so the first stretch of silence is fine.
    jest.advanceTimersByTime(900);
    jest.advanceTimersByTime(200);
    const error = await pending;
    expect(error).toBeInstanceOf(StallError);
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ type: "text", v: "Hel" }]);
    jest.useRealTimers();
  });

  it("reports a caller's abort as an abort, not a stall", async () => {
    class HangingXHR {
      status = 0;
      responseText = "";
      onprogress: (() => void) | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      getResponseHeader() {
        return null;
      }
      abort() {
        this.onabort?.();
      }
      send() {}
    }
    globalThis.XMLHttpRequest = HangingXHR as unknown as typeof XMLHttpRequest;

    const controller = new AbortController();
    const pending = readNdjsonViaXhr("https://ciciro.app/api/chat", {
      headers: new Headers(),
      body: "{}",
      signal: controller.signal,
    }).catch((error: unknown) => error);
    controller.abort();
    expect((await pending as Error).name).toBe("AbortError");
  });
});
