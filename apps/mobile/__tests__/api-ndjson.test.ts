import { readNdjson, StallError } from "../lib/api";

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("readNdjson", () => {
  it("forwards complete events and ignores pings, blanks, and malformed lines", async () => {
    const events: unknown[] = [];
    await readNdjson(
      streamFrom([
        '{"type":"ping"}\n',
        "\n",
        "not-json\n",
        '{"type":"text","v":"Hel"}\n{"type":"text","v":"lo"}\n',
      ]),
      { onEvent: (event) => events.push(event) }
    );
    expect(events).toEqual([
      { type: "text", v: "Hel" },
      { type: "text", v: "lo" },
    ]);
  });

  it("assembles an event split across chunks", async () => {
    const events: unknown[] = [];
    await readNdjson(streamFrom(['{"type":"text",', '"v":"Hi"}\n']), {
      onEvent: (event) => events.push(event),
    });
    expect(events).toEqual([{ type: "text", v: "Hi" }]);
  });

  it("throws StallError when the stream goes quiet", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start() {
        /* never enqueue */
      },
    });
    await expect(readNdjson(stream, { stallMs: 20 })).rejects.toBeInstanceOf(StallError);
  });

  it("throws when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readNdjson(streamFrom(['{"type":"text","v":"Hi"}\n']), { signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("flushes a trailing event that has no newline", async () => {
    const events: unknown[] = [];
    await readNdjson(streamFrom(['{"type":"text","v":"Hi"}']), {
      onEvent: (event) => events.push(event),
    });
    expect(events).toEqual([{ type: "text", v: "Hi" }]);
  });

  it("parses SSE-style data: lines", async () => {
    const events: unknown[] = [];
    await readNdjson(streamFrom(['data: {"type":"text","v":"Hi"}\n']), {
      onEvent: (event) => events.push(event),
    });
    expect(events).toEqual([{ type: "text", v: "Hi" }]);
  });
});
