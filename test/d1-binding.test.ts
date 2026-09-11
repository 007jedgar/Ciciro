import { describe, expect, it } from "vitest";
import { getD1Database, runWithD1Database } from "@/lib/d1-binding";

describe("runWithD1Database", () => {
  it("keeps concurrent request bindings from overwriting each other", async () => {
    const first = runWithD1Database({ id: "a" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return getD1Database();
    });
    const second = runWithD1Database({ id: "b" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return getD1Database();
    });
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual({ id: "a" });
    expect(b).toEqual({ id: "b" });
  });

  it("does not leak an ALS binding outside a request", () => {
    runWithD1Database({ id: "inside" }, () => {
      expect(getD1Database()).toEqual({ id: "inside" });
    });
    expect(getD1Database()).toBeUndefined();
  });

  it("falls back to the Worker binding when ALS is empty", async () => {
    const { setD1Database } = await import("@/lib/d1-binding");
    setD1Database({ id: "worker" });
    expect(getD1Database()).toEqual({ id: "worker" });
    expect(
      runWithD1Database({ id: "request" }, () => getD1Database())
    ).toEqual({ id: "request" });
    expect(getD1Database()).toEqual({ id: "worker" });
    setD1Database(undefined);
  });
});
