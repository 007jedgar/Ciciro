// The Worker runs with the `nodejs_compat` flag (wrangler.jsonc), which
// provides node:async_hooks at runtime. @cloudflare/workers-types does not
// declare Node modules, and pulling in all of @types/node would clash with the
// Workers globals, so declare only the surface the shared lib code uses.
declare module "node:async_hooks" {
  export class AsyncLocalStorage<T> {
    getStore(): T | undefined;
    run<R>(store: T, callback: () => R): R;
  }
}
