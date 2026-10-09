import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The menu over highlighted text (its actions, briefs, synonym lookup and case
 * matching) behaves the same on the desk and the phone. The Expo app cannot
 * import from the Next app, so there are two copies and nothing but this test
 * keeps them the same.
 *
 * If this fails, copy src/lib/selection-menu.ts over apps/mobile/lib/selection-menu.ts
 * (or the reverse). Fix the file, not the test.
 */
describe("selection menu parity between the desk and the phone", () => {
  it("keeps the two copies byte-for-byte identical", () => {
    const root = join(__dirname, "..");
    const server = readFileSync(join(root, "src/lib/selection-menu.ts"), "utf8");
    const phone = readFileSync(join(root, "apps/mobile/lib/selection-menu.ts"), "utf8");
    expect(phone).toBe(server);
  });
});
