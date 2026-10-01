/** Property on the OpenNext request context that holds this request's Prisma client. */
export const REQUEST_PRISMA = Symbol.for("ciciro.request-prisma");

/**
 * One value per request-context object. A second call with the same object
 * returns the first value, so a request does not build a new client per query.
 * Distinct context objects do not share a value.
 */
export function cachedOnContext<T>(context: object | null | undefined, create: () => T): T | undefined {
  if (!context) return undefined;
  const box = context as Record<symbol, T | undefined>;
  const existing = box[REQUEST_PRISMA];
  if (existing) return existing;
  const created = create();
  box[REQUEST_PRISMA] = created;
  return created;
}
