import {
  cacheFileName,
  decodeEntry,
  encodeEntry,
  floatToPcm16,
  memoryCacheFiles,
  normalizeSentence,
  pcm16ToFloat,
  SentenceCache,
  sentenceKey,
} from "../lib/sentence-cache";

const audio = (n: number, sampleRate = 24000) => ({
  samples: Int16Array.from({ length: n }, (_, i) => (i % 200) - 100),
  sampleRate,
});

describe("keys and names", () => {
  const base = { model: "kokoro-v1", voice: "af_heart", speed: 1, text: "Hello there." };

  it("ignores how the sentence was wrapped", () => {
    expect(normalizeSentence("  Hello\n  there. ")).toBe("Hello there.");
    expect(sentenceKey({ ...base, text: "Hello\nthere." })).toBe(sentenceKey(base));
  });

  it("changes with the model, voice, speed and text", () => {
    const keys = [
      sentenceKey(base),
      sentenceKey({ ...base, model: "kokoro-v2" }),
      sentenceKey({ ...base, voice: "af_sarah" }),
      sentenceKey({ ...base, speed: 1.25 }),
      sentenceKey({ ...base, text: "Hello there!" }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys.map(cacheFileName)).size).toBe(keys.length);
  });

  it("treats a speed of 1 and 1.001 as the same, since the model hears two decimals", () => {
    expect(sentenceKey({ ...base, speed: 1.001 })).toBe(sentenceKey(base));
  });

  it("names a file with 16 hex characters and no collisions across thousands of sentences", () => {
    const names = new Set<string>();
    for (let i = 0; i < 20000; i++) names.add(cacheFileName(sentenceKey({ ...base, text: `Sentence number ${i}.` })));
    expect(names.size).toBe(20000);
    expect([...names][0]).toMatch(/^[0-9a-f]{16}\.pcm$/);
  });
});

describe("PCM conversion", () => {
  it("round-trips samples within one 16-bit step and clamps overshoot", () => {
    const pcm = floatToPcm16([0, 0.5, -0.5, 1, -1, 2, -2]);
    expect(Array.from(pcm)).toEqual([0, 16384, -16384, 32767, -32768, 32767, -32768]);
    const back = pcm16ToFloat(pcm);
    expect(back[1]).toBeCloseTo(0.5, 3);
    expect(back[4]).toBe(-1);
    expect(back[3]).toBe(1);
  });

  it("encodes the sample rate ahead of the samples and decodes it back", () => {
    const entry = audio(10, 22050);
    const bytes = encodeEntry(entry);
    expect(bytes.byteLength).toBe(4 + 20);
    expect(decodeEntry(bytes)).toEqual(entry);
  });

  it("reads an entry sitting at an odd offset in a larger buffer", () => {
    const entry = audio(7);
    const bytes = encodeEntry(entry);
    const padded = new Uint8Array(bytes.byteLength + 3);
    padded.set(bytes, 3);
    expect(decodeEntry(padded.subarray(3))).toEqual(entry);
  });

  it("rejects damaged entries", () => {
    expect(decodeEntry(new Uint8Array(3))).toBeNull();
    expect(decodeEntry(new Uint8Array(7))).toBeNull();
    expect(decodeEntry(new Uint8Array(8))).toBeNull(); // sample rate 0
  });
});

describe("SentenceCache", () => {
  it("returns what was put and misses what was not", async () => {
    const cache = new SentenceCache(memoryCacheFiles(), { maxBytes: 1_000_000 });
    await cache.put("a", audio(100));
    expect(await cache.get("a")).toEqual(audio(100));
    expect(await cache.get("b")).toBeNull();
    expect(await cache.size()).toBe(4 + 200);
  });

  it("finds sentences saved in an earlier session", async () => {
    const files = memoryCacheFiles();
    await new SentenceCache(files, { maxBytes: 1_000_000 }).put("a", audio(50));
    const next = new SentenceCache(files, { maxBytes: 1_000_000 });
    expect(await next.size()).toBe(4 + 100);
    expect(await next.get("a")).toEqual(audio(50));
  });

  it("evicts the least recently used sentence to stay under the cap", async () => {
    const files = memoryCacheFiles();
    const cache = new SentenceCache(files, { maxBytes: 3 * (4 + 200) });
    await cache.put("a", audio(100));
    await cache.put("b", audio(100));
    await cache.put("c", audio(100));
    await cache.get("a"); // a is now newer than b
    await cache.put("d", audio(100));
    expect(await cache.get("b")).toBeNull();
    expect(await cache.get("a")).not.toBeNull();
    expect(await cache.get("c")).not.toBeNull();
    expect(await cache.get("d")).not.toBeNull();
    expect(await cache.size()).toBeLessThanOrEqual(3 * 204);
  });

  it("evicts files from an earlier session before anything used now", async () => {
    const files = memoryCacheFiles();
    const earlier = new SentenceCache(files, { maxBytes: 1_000_000 });
    await earlier.put("old", audio(100));
    const cache = new SentenceCache(files, { maxBytes: 2 * 204 });
    await cache.put("new1", audio(100));
    await cache.put("new2", audio(100));
    expect(await cache.get("old")).toBeNull();
    expect(await cache.get("new1")).not.toBeNull();
  });

  it("does not store one sentence bigger than the whole cap", async () => {
    const files = memoryCacheFiles();
    const cache = new SentenceCache(files, { maxBytes: 100 });
    await cache.put("big", audio(1000));
    expect(files.files.size).toBe(0);
  });

  it("drops a damaged file instead of playing it", async () => {
    const files = memoryCacheFiles();
    const cache = new SentenceCache(files, { maxBytes: 1_000_000 });
    await cache.put("a", audio(10));
    const [name] = [...files.files.keys()];
    files.files.set(name, new Uint8Array(3));
    expect(await cache.get("a")).toBeNull();
    expect(files.files.has(name)).toBe(false);
  });

  it("clears everything", async () => {
    const files = memoryCacheFiles();
    const cache = new SentenceCache(files, { maxBytes: 1_000_000 });
    await cache.put("a", audio(10));
    await cache.put("b", audio(10));
    await cache.clear();
    expect(files.files.size).toBe(0);
    expect(await cache.size()).toBe(0);
    expect(await cache.get("a")).toBeNull();
  });
});
