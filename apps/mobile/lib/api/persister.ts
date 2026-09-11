import { Platform } from "react-native";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";

// Persist the react-query cache so a warm reopen paints the last-seen
// manuscripts (and any open project) instantly, then revalidates in the
// background. MMKV is a synchronous native key-value store, so restore is
// effectively free on launch.

const CACHE_KEY = "ciciro-react-query-cache";
// Bump when the persisted shape changes (query keys, cached response types)
// so older caches are discarded instead of hydrated into a mismatched app.
export const CACHE_BUSTER = "v1";
// Drop anything older than a week; staleTime still forces a background refetch.
export const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
// Coalesce writes; the cache can change many times per interaction.
const THROTTLE_MS = 1000;

export type SyncStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function nativeStorage(): SyncStorage | null {
  if (Platform.OS === "web") return null;
  try {
    const { createMMKV } = require("react-native-mmkv") as typeof import("react-native-mmkv");
    const mmkv = createMMKV({ id: "ciciro-query-cache" });
    return {
      getItem: (key) => mmkv.getString(key) ?? null,
      setItem: (key, value) => {
        mmkv.set(key, value);
      },
      removeItem: (key) => {
        mmkv.remove(key);
      },
    };
  } catch {
    return null;
  }
}

function webStorage(): SyncStorage | null {
  try {
    const store = globalThis.localStorage;
    if (!store) return null;
    return {
      getItem: (key) => store.getItem(key),
      setItem: (key, value) => {
        store.setItem(key, value);
      },
      removeItem: (key) => {
        store.removeItem(key);
      },
    };
  } catch {
    return null;
  }
}

/** Storage backend, or null under tests / SSR where nothing is persisted. */
function resolveStorage(): SyncStorage | null {
  return nativeStorage() ?? webStorage();
}

/**
 * A throttled sync persister. When no storage backend is available (tests,
 * unexpected platform) every method is a no-op so the app still runs against a
 * pure in-memory cache.
 */
export function createQueryPersister(storageOverride?: SyncStorage | null): Persister {
  const storage = storageOverride === undefined ? resolveStorage() : storageOverride;
  if (!storage) {
    return {
      persistClient: () => Promise.resolve(),
      restoreClient: () => Promise.resolve(undefined),
      removeClient: () => Promise.resolve(),
    };
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PersistedClient | null = null;

  const flush = () => {
    timer = null;
    if (!pending) return;
    const client = pending;
    pending = null;
    try {
      storage.setItem(CACHE_KEY, JSON.stringify(client));
    } catch {
      /* quota / serialization failure: skip this write, try again next change */
    }
  };

  return {
    persistClient: (client) => {
      pending = client;
      if (timer) return;
      timer = setTimeout(flush, THROTTLE_MS);
    },
    restoreClient: () => {
      const raw = storage.getItem(CACHE_KEY);
      if (!raw) return undefined;
      try {
        return JSON.parse(raw) as PersistedClient;
      } catch {
        return undefined;
      }
    },
    removeClient: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
      storage.removeItem(CACHE_KEY);
    },
  };
}

export const queryPersister: Persister = createQueryPersister();

/** Drop the persisted cache from disk (used on logout / account switch). */
export function clearPersistedQueryCache(): void {
  void queryPersister.removeClient();
}
