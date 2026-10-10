import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The desk and the phone agree on whether a deadline is within reach. The Expo
 * app cannot import from the Next app, so there are two copies of
 * src/lib/deadline-pace.ts and nothing but this test keeps them the same.
 *
 * If this fails, copy src/lib/deadline-pace.ts over
 * apps/mobile/lib/deadline-pace.ts (or the reverse). Fix the file, not the test.
 */
describe("deadline pace parity between the server and the phone", () => {
  it("keeps the two copies byte-for-byte identical", () => {
    const root = join(__dirname, "..");
    const server = readFileSync(join(root, "src/lib/deadline-pace.ts"), "utf8");
    const phone = readFileSync(join(root, "apps/mobile/lib/deadline-pace.ts"), "utf8");
    expect(phone).toBe(server);
  });
});
