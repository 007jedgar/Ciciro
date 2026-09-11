import { createQueryPersister, type SyncStorage } from "../lib/api/persister";
import type { PersistedClient } from "@tanstack/react-query-persist-client";

function memoryStorage(): SyncStorage & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

const client: PersistedClient = {
  timestamp: 1,
  buster: "v1",
  clientState: { mutations: [], queries: [] },
};

describe("query persister", () => {
  jest.useFakeTimers();

  it("throttles writes and restores the persisted client", async () => {
    const storage = memoryStorage();
    const persister = createQueryPersister(storage);

    await persister.persistClient(client);
    // Write is deferred until the throttle window elapses.
    expect(storage.store.size).toBe(0);
    jest.advanceTimersByTime(1000);
    expect(storage.store.size).toBe(1);

    const restored = await persister.restoreClient();
    expect(restored).toEqual(client);

    await persister.removeClient();
    expect(storage.store.size).toBe(0);
  });

  it("returns undefined and no-ops when no storage is available", async () => {
    const persister = createQueryPersister(null);
    await persister.persistClient(client);
    await expect(persister.restoreClient()).resolves.toBeUndefined();
    await expect(persister.removeClient()).resolves.toBeUndefined();
  });

  it("survives a corrupt cache entry", async () => {
    const storage = memoryStorage();
    storage.store.set("ciciro-react-query-cache", "{not json");
    const persister = createQueryPersister(storage);
    expect(persister.restoreClient()).toBeUndefined();
  });
});
