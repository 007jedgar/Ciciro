import { describe, expect, it } from "vitest";
import { isMissingRelationError, responseFromDbError } from "@/lib/auth/http";

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
});
