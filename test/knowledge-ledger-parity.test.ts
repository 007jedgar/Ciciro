import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The server, the desk, and the phone agree on what "as of chapter N" means
 * for the who-knows-what ledger. The Expo app cannot import from the Next app,
 * so there are two copies of src/lib/knowledge-ledger.ts and nothing but this
 * test keeps them the same.
 *
 * If this fails, copy src/lib/knowledge-ledger.ts over
 * apps/mobile/lib/knowledge-ledger.ts (or the reverse). Fix the file, not the test.
 */
describe("knowledge ledger parity between the server and the phone", () => {
  it("keeps the two copies byte-for-byte identical", () => {
    const root = join(__dirname, "..");
    const server = readFileSync(join(root, "src/lib/knowledge-ledger.ts"), "utf8");
    const phone = readFileSync(join(root, "apps/mobile/lib/knowledge-ledger.ts"), "utf8");
    expect(phone).toBe(server);
  });
});
