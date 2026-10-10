import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The desk, the server, and the phone set a script on the same page: the same
 * elements, the same wrapped lines, the same page breaks. The Expo app cannot
 * import from the Next app, so there are two copies of that code and nothing
 * but this test keeps them the same. When they drift, the phone and the desk
 * count different pages for one script.
 *
 * If this fails, copy src/lib/screenplay.ts over apps/mobile/lib/screenplay.ts
 * (or the reverse). Fix the file, not the test.
 */
describe("screenplay parity between the server and the phone", () => {
  it("keeps the two copies byte-for-byte identical", () => {
    const root = join(__dirname, "..");
    const server = readFileSync(join(root, "src/lib/screenplay.ts"), "utf8");
    const phone = readFileSync(join(root, "apps/mobile/lib/screenplay.ts"), "utf8");
    expect(phone).toBe(server);
  });
});
