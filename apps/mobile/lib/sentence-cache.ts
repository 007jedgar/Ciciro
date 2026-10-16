/**
 * Disk cache for synthesised sentences, so hearing a chapter again (or a
 * chapter after a small edit) only synthesises the sentences that changed.
 *
 * One file per sentence: a 4-byte little-endian sample rate, then 16-bit mono
 * PCM. The key is the model pack, voice, speed and the sentence's text, so a
 * new model, a new voice or a different speed never plays stale audio. The
 * cache holds nothing the writer wrote that is not already on the device as
 * text, but it is still the writer's words: it lives in the app's cache
 * directory and "Clear saved audio" in Listening settings removes it.
 */

export type CachedSentence = { samples: Int16Array; sampleRate: number };

/** The file operations the cache needs, so tests can use memory. */
export type CacheFiles = {
  list(): Promise<{ name: string; bytes: number }[]>;
  read(name: string): Promise<Uint8Array | null>;
  write(name: string, bytes: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
};

/** Collapses runs of whitespace so the same sentence wrapped differently is the same key. */
export function normalizeSentence(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function sentenceKey(parts: { model: string; voice: string; speed: number; text: string }): string {
  return [parts.model, parts.voice, parts.speed.toFixed(2), normalizeSentence(parts.text)].join("␟");
}

function fnv1a(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function mix(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    let k = Math.imul(text.charCodeAt(i), 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  }
  h ^= text.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A 64-bit hash of the key as 16 hex characters, two independent 32-bit hashes side by side. */
export function cacheFileName(key: string): string {
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  return `${hex(fnv1a(key, 0x811c9dc5))}${hex(mix(key, 0x9747b28c))}.pcm`;
}

export function floatToPcm16(samples: ArrayLike<number>): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    out[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
  }
  return out;
}

export function pcm16ToFloat(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] / (samples[i] < 0 ? 32768 : 32767);
  return out;
}

export function encodeEntry(audio: CachedSentence): Uint8Array {
  const out = new Uint8Array(4 + audio.samples.byteLength);
  new DataView(out.buffer).setUint32(0, audio.sampleRate, true);
  out.set(new Uint8Array(audio.samples.buffer, audio.samples.byteOffset, audio.samples.byteLength), 4);
  return out;
}

export function decodeEntry(bytes: Uint8Array): CachedSentence | null {
  if (bytes.byteLength < 6 || (bytes.byteLength - 4) % 2 !== 0) return null;
  const sampleRate = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (sampleRate < 8000 || sampleRate > 96000) return null;
  // Copy to a fresh buffer: Int16Array needs a 2-byte-aligned offset and `bytes` may sit at an odd one.
  const body = bytes.slice(4);
  return { sampleRate, samples: new Int16Array(body.buffer, 0, body.byteLength / 2) };
}

export class SentenceCache {
  private index: Map<string, number> | null = null;
  private used = new Map<string, number>();
  private tick = 0;
  private total = 0;
  private loading: Promise<void> | null = null;

  constructor(
    private files: CacheFiles,
    private options: { maxBytes: number }
  ) {}

  private async load() {
    if (this.index) return;
    this.loading ??= (async () => {
      const index = new Map<string, number>();
      let total = 0;
      for (const f of await this.files.list()) {
        if (!f.name.endsWith(".pcm")) continue;
        index.set(f.name, f.bytes);
        total += f.bytes;
      }
      this.index = index;
      this.total = total;
    })();
    await this.loading;
  }

  async get(key: string): Promise<CachedSentence | null> {
    await this.load();
    const name = cacheFileName(key);
    if (!this.index!.has(name)) return null;
    const bytes = await this.files.read(name);
    const entry = bytes ? decodeEntry(bytes) : null;
    if (!entry) {
      await this.drop(name);
      return null;
    }
    this.used.set(name, ++this.tick);
    return entry;
  }

  async put(key: string, audio: CachedSentence): Promise<void> {
    await this.load();
    const name = cacheFileName(key);
    const bytes = encodeEntry(audio);
    if (bytes.byteLength > this.options.maxBytes) return;
    await this.files.write(name, bytes);
    this.total += bytes.byteLength - (this.index!.get(name) ?? 0);
    this.index!.set(name, bytes.byteLength);
    this.used.set(name, ++this.tick);
    await this.evict(name);
  }

  /** Total bytes saved. */
  async size(): Promise<number> {
    await this.load();
    return this.total;
  }

  async clear(): Promise<void> {
    await this.load();
    for (const name of [...this.index!.keys()]) await this.files.remove(name);
    this.index!.clear();
    this.used.clear();
    this.total = 0;
  }

  /**
   * Least recently used first. Files from an earlier session have no recency
   * yet, so they go before anything touched in this one.
   */
  private async evict(keep: string) {
    if (this.total <= this.options.maxBytes) return;
    const order = [...this.index!.keys()]
      .filter((name) => name !== keep)
      .sort((a, b) => (this.used.get(a) ?? 0) - (this.used.get(b) ?? 0));
    for (const name of order) {
      if (this.total <= this.options.maxBytes) break;
      await this.drop(name);
    }
  }

  private async drop(name: string) {
    this.total -= this.index!.get(name) ?? 0;
    this.index!.delete(name);
    this.used.delete(name);
    await this.files.remove(name).catch(() => {});
  }
}

/** A cache over a plain Map, for tests and as a fallback when no disk is available. */
export function memoryCacheFiles(): CacheFiles & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async list() {
      return [...files].map(([name, bytes]) => ({ name, bytes: bytes.byteLength }));
    },
    async read(name) {
      return files.get(name) ?? null;
    },
    async write(name, bytes) {
      files.set(name, bytes);
    },
    async remove(name) {
      files.delete(name);
    },
  };
}
