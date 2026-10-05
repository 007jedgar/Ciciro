import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The desk, the server, and the phone agree on what the chat's Allow edits /
 * Chat only switch means. The Expo app cannot import from the Next app, so
 * there are two copies of src/lib/edit-mode.ts and nothing but this test keeps
 * them the same.
 *
 * If this fails, copy src/lib/edit-mode.ts over apps/mobile/lib/edit-mode.ts
 * (or the reverse). Fix the file, not the test.
 */
describe("edit mode parity between the server and the phone", () => {
  it("keeps the two copies byte-for-byte identical", () => {
    const root = join(__dirname, "..");
    const server = readFileSync(join(root, "src/lib/edit-mode.ts"), "utf8");
    const phone = readFileSync(join(root, "apps/mobile/lib/edit-mode.ts"), "utf8");
    expect(phone).toBe(server);
  });
});
