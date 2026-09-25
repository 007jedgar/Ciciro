import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The desk, the server, and the phone all read, resolve, and rewrite the same
 * inline suggestion marks. The Expo app cannot import from the Next app, so
 * there are two copies of that code and nothing but this test keeps them the
 * same. When they drift, one device accepts a change the other cannot see.
 *
 * If this fails, copy src/lib/suggestions.ts over apps/mobile/lib/suggestions.ts
 * (or the reverse). Fix the file, not the test.
 */
describe("suggestions parity between the server and the phone", () => {
  it("keeps the two copies byte-for-byte identical", () => {
    const root = join(__dirname, "..");
    const server = readFileSync(join(root, "src/lib/suggestions.ts"), "utf8");
    const phone = readFileSync(join(root, "apps/mobile/lib/suggestions.ts"), "utf8");
    expect(phone).toBe(server);
  });
});
