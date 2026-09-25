import { unzipSync } from "fflate";

/** Most text an import may inflate to, across every entry it reads. */
export const UNZIP_MAX_BYTES = 200 * 1024 * 1024;

/**
 * Unzip only the entries `keep` accepts, refusing archives whose declared
 * uncompressed size would exceed UNZIP_MAX_BYTES before anything is inflated.
 */
export function unzipEntries(
  data: Uint8Array,
  keep: (name: string) => boolean,
  invalidMessage: string
): Record<string, Uint8Array> {
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (f) => {
        if (!keep(f.name)) return false;
        total += f.originalSize;
        return total <= UNZIP_MAX_BYTES;
      },
    });
  } catch {
    throw new Error(invalidMessage);
  }
  if (total > UNZIP_MAX_BYTES) {
    throw new Error("That file expands to more than 200 MB of text, too large to import.");
  }
  return files;
}
