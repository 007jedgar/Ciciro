/**
 * The natural voice as the app uses it: the engine, its model, its speaker and
 * its saved audio, put together once. Everything here is lazy and guarded, so
 * where a native piece is missing (web, an older dev client, tests) Listen
 * simply reads with the system voice.
 */
import { Platform } from "react-native";
import { createKokoroEngine, type EngineEvent, type KokoroEngine } from "./kokoro-engine";
import { getNaturalAudioOutput } from "./natural-audio-output";
import { naturalModelPath, getNaturalInstaller } from "./natural-model-store";
import { KOKORO_PACK } from "./natural-pack";
import { createExecuTorchRuntime } from "./natural-runtime-executorch";
import { SentenceCache, type CacheFiles } from "./sentence-cache";

/** The most saved audio kept: about 70 minutes of speech, then the oldest goes first. */
export const SENTENCE_CACHE_BYTES = 200 * 1024 * 1024;

function deviceCacheFiles(): CacheFiles {
  const { File, Directory, Paths } = require("expo-file-system") as typeof import("expo-file-system");
  const dir = new Directory(Paths.cache, "natural-audio");
  const ensure = () => dir.create({ intermediates: true, idempotent: true });
  return {
    async list() {
      if (!dir.exists) return [];
      return dir
        .list()
        .filter((e): e is InstanceType<typeof File> => e instanceof File)
        .map((f) => ({ name: f.name, bytes: f.size }));
    },
    async read(name) {
      const file = new File(dir, name);
      return file.exists ? file.bytes() : null;
    },
    async write(name, bytes) {
      ensure();
      const file = new File(dir, name);
      file.create({ overwrite: true });
      file.write(bytes);
    },
    async remove(name) {
      const file = new File(dir, name);
      if (file.exists) file.delete();
    },
  };
}

let cache: SentenceCache | null = null;
export function getSentenceCache(): SentenceCache {
  cache ??= new SentenceCache(deviceCacheFiles(), { maxBytes: SENTENCE_CACHE_BYTES });
  return cache;
}

export async function clearNaturalAudioCache(): Promise<void> {
  try {
    await getSentenceCache().clear();
  } catch {
    /* no file system: nothing was saved */
  }
}

export async function naturalAudioCacheBytes(): Promise<number> {
  try {
    return await getSentenceCache().size();
  } catch {
    return 0;
  }
}

let available: boolean | null = null;
/** Whether this build has everything the natural voice needs: audio, the model runtime and a file system. */
export function naturalNativeAvailable(): boolean {
  if (available !== null) return available;
  if (Platform.OS === "web") return (available = false);
  try {
    // Importing the package installs its native bridge and throws where the native library is absent.
    require("react-native-executorch");
    available = getNaturalAudioOutput() !== null && getNaturalInstaller() !== null;
  } catch {
    available = false;
  }
  return available;
}

const listeners = new Set<(event: EngineEvent) => void>();
/** Hears what the engine reports (for analytics and the "kept up or fell back" notice). */
export function onNaturalEngineEvent(listener: (event: EngineEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let engine: KokoroEngine | null = null;
export function getNaturalEngine(): KokoroEngine | null {
  if (engine) return engine;
  const output = getNaturalAudioOutput();
  if (!output || !naturalNativeAvailable()) return null;
  engine = createKokoroEngine({
    runtime: createExecuTorchRuntime({ modelPath: naturalModelPath }),
    output,
    cache: getSentenceCache(),
    modelId: KOKORO_PACK.id,
    report: (event) => listeners.forEach((l) => l(event)),
  });
  return engine;
}

/** Stops any natural read and frees the model, e.g. before the model files are deleted. */
export async function disposeNaturalEngine(): Promise<void> {
  const current = engine;
  engine = null;
  await current?.dispose();
}

/** Forgets everything built so far (tests). */
export function resetNaturalEngineForTests() {
  engine = null;
  cache = null;
  available = null;
  listeners.clear();
}
