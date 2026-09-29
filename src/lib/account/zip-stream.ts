import { Zip, ZipDeflate, ZipPassThrough, type ZipInputFile } from "fflate";

const encoder = new TextEncoder();

export type ZipEntry = {
  write(chunk: string | Uint8Array): void;
  close(): void;
};

/**
 * A zip built entry by entry, in bounded memory: every write compresses
 * immediately and the finished bytes wait in `pending` until `drain()` hands
 * them to the response stream. Only one entry is open at a time, so fflate
 * never has to buffer a later entry behind an unfinished one.
 */
export class ZipWriter {
  private readonly zip: Zip;
  private pending: Uint8Array[] = [];
  private failure: Error | null = null;
  private open: ZipInputFile | null = null;

  constructor() {
    this.zip = new Zip((err, data) => {
      if (err) this.failure = err;
      else if (data.length) this.pending.push(data);
    });
  }

  /** Start an entry. `compress: false` stores bytes that are already compressed (docx). */
  entry(name: string, opts: { compress?: boolean } = {}): ZipEntry {
    if (this.open) throw new Error(`zip entry ${this.open.filename} is still open`);
    const file =
      opts.compress === false ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 });
    this.zip.add(file);
    this.open = file;
    return {
      write: (chunk) => {
        const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
        if (bytes.length) file.push(bytes);
      },
      close: () => {
        file.push(new Uint8Array(0), true);
        this.open = null;
      },
    };
  }

  /** Add a whole entry at once. */
  file(name: string, contents: string | Uint8Array, opts: { compress?: boolean } = {}): void {
    const entry = this.entry(name, opts);
    entry.write(contents);
    entry.close();
  }

  /** Write the central directory. Drain once more afterwards for the tail. */
  end(): void {
    this.zip.end();
  }

  /** The bytes produced since the last drain, as one chunk (or null). */
  drain(): Uint8Array | null {
    if (this.failure) throw this.failure;
    if (!this.pending.length) return null;
    const chunks = this.pending;
    this.pending = [];
    if (chunks.length === 1) return chunks[0];
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}

/** A pull-driven byte stream over an async generator: nothing runs ahead of the reader. */
export function streamFromChunks(
  chunks: AsyncGenerator<Uint8Array, void, undefined>,
  onError: (error: unknown) => void
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const next = await chunks.next();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch (error) {
          onError(error);
          controller.error(error);
        }
      },
      async cancel() {
        await chunks.return(undefined);
      },
    },
    { highWaterMark: 0 }
  );
}
