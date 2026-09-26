import { beforeEach, describe, expect, it, vi } from "vitest";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe("web focus mode", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", memoryStorage());
  });

  it("starts off and persists per browser across reloads", async () => {
    const first = await import("@/lib/focus-mode");
    expect(first.getFocusMode()).toBe(false);
    first.setFocusMode(true);
    expect(first.getFocusMode()).toBe(true);

    vi.resetModules();
    const reloaded = await import("@/lib/focus-mode");
    expect(reloaded.getFocusMode()).toBe(true);
    reloaded.setFocusMode(false);

    vi.resetModules();
    const again = await import("@/lib/focus-mode");
    expect(again.getFocusMode()).toBe(false);
  });

  it("never lands in the synced settings", async () => {
    const { setFocusMode } = await import("@/lib/focus-mode");
    const { SETTINGS_STORAGE_KEY } = await import("@/lib/settings");
    setFocusMode(true);
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
  });
});
