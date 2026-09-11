const DISK_KEY = "last-place";
const ID = /^[A-Za-z0-9_-]{1,80}$/;
export const DEFAULT_HREF = "/manuscripts";

export type LastPlace = {
  screen: string;
  manuscriptId: string | null;
};

type StoredPlace = LastPlace & { userId: string };

/** In-memory copy so Fast Refresh and a cold start share the same last place. */
let lastScreen: string | null = null;
let lastManuscript: string | null = null;
let lastUserId: string | null = null;
let hydrated = false;

function isId(value: string): boolean {
  return ID.test(value);
}

function normalizePath(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed || trimmed === "/") return "/";
  return trimmed.replace(/\/+$/, "") || "/";
}

type Disk = {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
};

function fallbackDisk(): Disk {
  const g = globalThis as typeof globalThis & { __ciciroLastPlace?: Map<string, string> };
  if (!g.__ciciroLastPlace) g.__ciciroLastPlace = new Map();
  const map = g.__ciciroLastPlace;
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

function disks(): Disk[] {
  return [nativeDisk(), webDisk(), fallbackDisk()].filter((store): store is Disk => store !== null);
}

function parseStored(raw: unknown): StoredPlace | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<StoredPlace>;
  if (typeof value.userId !== "string" || !isId(value.userId)) return null;
  if (typeof value.screen !== "string") return null;
  const manuscriptId =
    typeof value.manuscriptId === "string" && isId(value.manuscriptId)
      ? value.manuscriptId
      : null;
  const normalized = applyPathname({ screen: DEFAULT_HREF, manuscriptId }, value.screen);
  if (!normalized) return null;
  return { userId: value.userId, screen: normalized.screen, manuscriptId: normalized.manuscriptId };
}

function readDisk(): StoredPlace | null {
  for (const store of disks()) {
    try {
      const raw = store.getString(DISK_KEY);
      if (!raw) continue;
      const parsed = parseStored(JSON.parse(raw));
      if (parsed) return parsed;
    } catch {
      /* try the next store */
    }
  }
  return null;
}

function writeDisk(stored: StoredPlace | null): void {
  for (const store of disks()) {
    try {
      if (!stored) store.remove(DISK_KEY);
      else store.set(DISK_KEY, JSON.stringify(stored));
    } catch {
      /* try the next store */
    }
  }
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  const stored = readDisk();
  if (!stored) return;
  lastUserId = stored.userId;
  lastScreen = stored.screen;
  lastManuscript = stored.manuscriptId;
}

function persist(): void {
  if (!lastUserId || !lastScreen) return;
  writeDisk({
    userId: lastUserId,
    screen: lastScreen,
    manuscriptId: lastManuscript,
  });
}

/**
 * Update last-place from a route. Returns null when the path is transient
 * (welcome, auth, settings, create flows) so those screens are not restored later.
 */
export function applyPathname(place: LastPlace, pathname: string): LastPlace | null {
  const path = normalizePath(pathname);
  if (path === "/manuscripts") {
    return { screen: "/manuscripts", manuscriptId: place.manuscriptId };
  }
  const folder = path.match(/^\/folder\/([^/]+)$/);
  if (folder?.[1] && isId(folder[1])) {
    return { screen: `/folder/${folder[1]}`, manuscriptId: place.manuscriptId };
  }
  const project = path.match(/^\/project\/([^/]+)(?:\/(chapters|manuscript|ciciro))?$/);
  if (project?.[1] && isId(project[1])) {
    const tab = project[2] ?? "chapters";
    return {
      screen: `/project/${project[1]}/${tab}`,
      manuscriptId: project[1],
    };
  }
  return null;
}

export function hrefForLastPlace(place: LastPlace | null): string {
  if (!place) return DEFAULT_HREF;
  const fromScreen = applyPathname(
    { screen: DEFAULT_HREF, manuscriptId: place.manuscriptId },
    place.screen
  );
  if (fromScreen) return fromScreen.screen;
  if (place.manuscriptId && isId(place.manuscriptId)) {
    return `/project/${place.manuscriptId}/chapters`;
  }
  return DEFAULT_HREF;
}

export function rememberPathname(pathname: string, userId: string): void {
  if (!isId(userId)) return;
  hydrate();
  const current: LastPlace = {
    screen: lastUserId === userId ? lastScreen ?? DEFAULT_HREF : DEFAULT_HREF,
    manuscriptId: lastUserId === userId ? lastManuscript : null,
  };
  const next = applyPathname(current, pathname);
  if (!next) return;
  lastUserId = userId;
  lastScreen = next.screen;
  lastManuscript = next.manuscriptId;
  persist();
}

export function getLastPlace(userId: string): LastPlace | null {
  hydrate();
  if (!lastScreen || lastUserId !== userId) return null;
  return { screen: lastScreen, manuscriptId: lastManuscript };
}

export function getLastScreen(): string | null {
  hydrate();
  return lastScreen;
}

export function getLastManuscript(): string | null {
  hydrate();
  return lastManuscript;
}

export function restoreHref(userId: string): string {
  return hrefForLastPlace(getLastPlace(userId));
}

/** Simulate a process restart: memory is gone, disk remains. */
export function unloadLastPlace(): void {
  lastScreen = null;
  lastManuscript = null;
  lastUserId = null;
  hydrated = false;
}

/** Drop in-memory + disk state. Used by tests. */
export function resetLastPlace(): void {
  unloadLastPlace();
  writeDisk(null);
}
