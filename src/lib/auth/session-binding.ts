import { AsyncLocalStorage } from "node:async_hooks";

// Per-request session token from the Worker entry. OpenNext's cookie jar
// often misses React Native's Cookie / x-ciciro-session headers; the Worker
// reads the raw Request and publishes it here for getSessionUser().
const store = new AsyncLocalStorage<string | null>();

export function runWithRequestSession<T>(token: string | null, fn: () => T): T {
  return store.run(token, fn);
}

export function peekRequestSession(): string | null | undefined {
  return store.getStore();
}
