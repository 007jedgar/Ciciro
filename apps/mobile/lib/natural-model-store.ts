/**
 * The natural-voice model on this device: one installer for the whole app, so a
 * download keeps going while the writer leaves Listening settings, and a hook
 * the screens read.
 *
 * Files live in the app's cache folder, which the OS keeps out of backups (a
 * 380 MB model in an iCloud or Android backup would be rude, and over
 * Android's 25 MB auto-backup limit it would stop that app's backup). The cost
 * is that "Clear cache" or a very low disk can remove it; the screen then
 * simply offers the download again.
 */
import { useSyncExternalStore } from "react";
import { ModelInstaller, type InstallerDeps, type ModelState } from "./natural-model";
import { KOKORO_PACK } from "./natural-pack";

/** `file:///var/x%20y/` to `/var/x y`: what native code that takes a path wants. */
export function toPlainPath(uri: string): string {
  const stripped = uri.replace(/^file:\/\//, "");
  try {
    return decodeURI(stripped);
  } catch {
    return stripped;
  }
}

/** The file and network operations for a real device. */
export function deviceInstallerDeps(): InstallerDeps {
  const fs = require("expo-file-system") as typeof import("expo-file-system");
  const { File, Directory, Paths, FileMode } = fs;
  const fileAt = (uri: string) => new File(uri);
  const dirAt = (uri: string) => new Directory(uri);

  return {
    availableBytes: () => Paths.availableDiskSpace,
    exists: (uri) => fileAt(uri).exists || dirAt(uri).exists,
    size: (uri) => {
      const file = fileAt(uri);
      return file.exists ? file.size : null;
    },
    ensureDir: (uri) => dirAt(uri).create({ intermediates: true, idempotent: true }),
    remove: (uri) => {
      const file = fileAt(uri);
      if (file.exists) return file.delete();
      const dir = dirAt(uri);
      if (dir.exists) dir.delete();
    },
    move: (from, to) => {
      const target = fileAt(to);
      if (target.exists) target.delete();
      fileAt(from).moveSync(target);
    },
    treeBytes: (uri) => {
      const walk = (dir: InstanceType<typeof Directory>): number =>
        dir.list().reduce((n, entry) => n + (entry instanceof Directory ? walk(entry) : (entry as InstanceType<typeof File>).size), 0);
      const dir = dirAt(uri);
      return dir.exists ? walk(dir) : 0;
    },
    append: async (to, from) => {
      const target = fileAt(to);
      if (!target.exists) target.create({ intermediates: true });
      const source = fileAt(from).open(FileMode.ReadOnly);
      const sink = target.open(FileMode.Append);
      try {
        const total = source.size ?? 0;
        for (let read = 0; read < total; ) {
          const block = source.readBytes(Math.min(4 * 1024 * 1024, total - read));
          if (block.byteLength === 0) break;
          sink.writeBytes(block);
          read += block.byteLength;
        }
      } finally {
        source.close();
        sink.close();
      }
    },
    readText: (uri) => {
      const file = fileAt(uri);
      return file.exists ? file.textSync() : null;
    },
    writeText: (uri, text) => {
      const file = fileAt(uri);
      file.create({ intermediates: true, overwrite: true });
      file.write(text);
    },
    fetchRange: async (url, dest, range, { signal, onProgress }) => {
      await File.downloadFileAsync(url, fileAt(dest), {
        headers: { Range: `bytes=${range.from}-${range.to}` },
        idempotent: true,
        signal,
        onProgress: ({ bytesWritten }) => onProgress(bytesWritten),
      });
    },
    sleep: (ms, signal) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(new Error("aborted"));
        const timer = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        });
      }),
  };
}

let installer: ModelInstaller | null = null;
let state: ModelState = { status: "absent" };
const listeners = new Set<() => void>();

/** Where the natural-voice files live: the app's cache folder. */
function rootUri(): string {
  const { Paths } = require("expo-file-system") as typeof import("expo-file-system");
  return `${Paths.cache.uri.replace(/\/$/, "")}/natural-voice`;
}

/** The app's installer, or null where there is no file system (web, tests without a mock). */
export function getNaturalInstaller(): ModelInstaller | null {
  if (installer) return installer;
  try {
    installer = new ModelInstaller(KOKORO_PACK, rootUri(), deviceInstallerDeps(), (next) => {
      state = next;
      for (const listener of listeners) listener();
    });
    state = installer.refresh();
    return installer;
  } catch {
    return null;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What is on the device, live. Reads the disk the first time it is asked. */
export function useNaturalModelState(): ModelState {
  return useSyncExternalStore(
    (listener) => {
      getNaturalInstaller();
      return subscribe(listener);
    },
    () => state,
    () => state
  );
}

export function naturalModelState(): ModelState {
  getNaturalInstaller();
  return state;
}

/** The folder the runtime opens the model's files from, or null when it is not installed. */
export function naturalModelPath(): string | null {
  const current = getNaturalInstaller();
  return current && state.status === "ready" ? toPlainPath(current.modelPath) : null;
}

/** Looks at the disk again (the writer may have cleared the cache). */
export function refreshNaturalModel(): ModelState {
  return getNaturalInstaller()?.refresh() ?? state;
}

/** Forgets the installer (tests). */
export function resetNaturalModelForTests() {
  installer = null;
  state = { status: "absent" };
  listeners.clear();
}
