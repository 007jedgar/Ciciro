import { describe, expect, it } from "vitest";
import { cachedOnContext } from "@/lib/request-prisma";

describe("cachedOnContext", () => {
  it("reuses one value for a request and isolates concurrent requests", () => {
    const first = {};
    const second = {};
    const created: string[] = [];
    const create = (label: string) => () => {
      created.push(label);
      return { label };
    };

    expect(cachedOnContext(first, create("a"))).toEqual({ label: "a" });
    expect(cachedOnContext(first, create("a-again"))).toEqual({ label: "a" });
    expect(cachedOnContext(second, create("b"))).toEqual({ label: "b" });
    expect(created).toEqual(["a", "b"]);
  });

  it("returns undefined when there is no request context", () => {
    expect(cachedOnContext(undefined, () => ({ label: "x" }))).toBeUndefined();
    expect(cachedOnContext(null, () => ({ label: "x" }))).toBeUndefined();
  });
});
