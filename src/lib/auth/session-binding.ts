import { AsyncLocalStorage } from "node:async_hooks";

// Per-request session token from the Worker entry. OpenNext often continues
// the Next.js handler outside this ALS (same class of bug as D1). Cookie
// injection on the Request plus getSessionUser(req) are the reliable paths;
// this store is a best-effort extra.
const store = new AsyncLocalStorage<string | null>();

export function runWithRequestSession<T>(token: string | null, fn: () => T): T {
  return store.run(token, fn);
}

export function peekRequestSession(): string | null | undefined {
  return store.getStore();
}
