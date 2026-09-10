import * as SecureStore from "expo-secure-store";
import type { PublicUser } from "./types";

export const SESSION_COOKIE_NAME = "ciciro_session";
export const SESSION_HEADER = "x-ciciro-session";
export const NATIVE_CLIENT_HEADER = "x-ciciro-client";
export const NATIVE_CLIENT_VALUE = "native";

const TOKEN_KEY = "ciciro_session";
const USER_KEY = "ciciro_session_user";

let memoryToken: string | null = null;
let hydrated = false;

type Disk = {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
};

function nativeDisk(): Disk | null {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    const prefs = getPrefs();
    return {
      getString: (key) => prefs.getString(key),
      set: (key, value) => {
        prefs.set(key, value);
      },
      remove: (key) => {
        prefs.remove(key);
      },
    };
  } catch {
    return null;
  }
}

function webDisk(): Disk | null {
  try {
    const store = globalThis.localStorage;
    if (!store) return null;
    return {
      getString: (key) => store.getItem(key) ?? undefined,
      set: (key, value) => {
        store.setItem(key, value);
      },
      remove: (key) => {
        store.removeItem(key);
      },
    };
  } catch {
    return null;
  }
}

function fallbackDisk(): Disk {
  const g = globalThis as typeof globalThis & { __ciciroSessionDisk?: Map<string, string> };
  if (!g.__ciciroSessionDisk) g.__ciciroSessionDisk = new Map();
  const map = g.__ciciroSessionDisk;
  return {
    getString: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
}

function disk(): Disk {
  return nativeDisk() ?? webDisk() ?? fallbackDisk();
}

function readDisk(key: string): string | null {
  try {
    return disk()?.getString(key) ?? null;
  } catch {
    return null;
  }
}

function writeDisk(key: string, value: string | null): void {
  try {
    const store = disk();
    if (!store) return;
    if (value) store.set(key, value);
    else store.remove(key);
  } catch {
    /* web / tests / missing native module */
  }
}

export function getSessionToken(): string | null {
  if (memoryToken) return memoryToken;
  const stored = readDisk(TOKEN_KEY);
  if (stored) {
    memoryToken = stored;
    return stored;
  }
  return null;
}

export function setSessionToken(token: string | null): void {
  memoryToken = token;
  hydrated = true;
  writeDisk(TOKEN_KEY, token);
  if (token) {
    void SecureStore.setItemAsync(TOKEN_KEY, token).catch(() => {
      /* web / missing native module */
    });
  } else {
    writeDisk(USER_KEY, null);
    void SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  }
}

export async function hydrateSessionToken(): Promise<string | null> {
  try {
    const stored = await SecureStore.getItemAsync(TOKEN_KEY);
    if (stored) {
      memoryToken = stored;
      hydrated = true;
      writeDisk(TOKEN_KEY, stored);
      return stored;
    }
  } catch {
    /* fall through to sync disk */
  }
  const sync = readDisk(TOKEN_KEY);
  if (sync) {
    memoryToken = sync;
    hydrated = true;
    return sync;
  }
  hydrated = true;
  return memoryToken;
}

/** Re-read SecureStore after Metro reloads wipe the in-memory token. */
export async function ensureSessionToken(): Promise<string | null> {
  const existing = getSessionToken();
  if (existing || hydrated) return existing;
  return hydrateSessionToken();
}

/** Drop in-memory state the way a Fast Refresh / Metro reload does. */
export function resetSessionMemory(): void {
  memoryToken = null;
  hydrated = false;
}

export function getCachedUser(): PublicUser | null {
  const raw = readDisk(USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PublicUser>;
    if (
      typeof parsed.id === "string" &&
      typeof parsed.email === "string" &&
      typeof parsed.name === "string"
    ) {
      return { id: parsed.id, email: parsed.email, name: parsed.name };
    }
  } catch {
    /* ignore corrupt cache */
  }
  return null;
}

export function setCachedUser(user: PublicUser | null): void {
  writeDisk(USER_KEY, user ? JSON.stringify(user) : null);
}
