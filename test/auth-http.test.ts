import { describe, expect, it } from "vitest";
import { SESSION_COOKIE, SESSION_HEADER } from "@/lib/auth/constants";
import { isMissingRelationError, jsonWithSession, responseFromDbError } from "@/lib/auth/http";

describe("database error mapping", () => {
  it("maps a missing Prisma/D1 table to a 500 JSON body", async () => {
    expect(isMissingRelationError({ code: "P2021", message: "The table does not exist" })).toBe(true);
    expect(isMissingRelationError(new Error("D1_ERROR: no such table: WritingDay"))).toBe(true);
    expect(isMissingRelationError(new Error("Authentication required."))).toBe(false);

    const mapped = responseFromDbError(new Error("no such table: ChapterOp"));
    expect(mapped).not.toBeNull();
    expect(mapped?.status).toBe(500);
    await expect(mapped?.json()).resolves.toEqual({
      error: "Database is missing a required table.",
    });
    expect(responseFromDbError(new Error("Authentication required."))).toBeNull();
  });

  it("puts the session on Set-Cookie so login does not need cookies().set", () => {
    const res = jsonWithSession({ user: { id: "u1" } }, "tok-123", false);
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBe("tok-123");
    expect(res.headers.get(SESSION_HEADER)).toBeNull();
    expect(res.headers.get("set-cookie")).toMatch(/ciciro_session=tok-123/);
  });

  it("also returns the native session header", () => {
    const res = jsonWithSession({ user: { id: "u1" } }, "tok-123", true);
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBe("tok-123");
    expect(res.headers.get(SESSION_HEADER)).toBe("tok-123");
  });
});
