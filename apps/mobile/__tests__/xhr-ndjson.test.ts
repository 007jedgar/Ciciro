import { readNdjsonViaXhr, shouldUseXhrNdjson } from "../lib/api/xhr-ndjson";

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
});
