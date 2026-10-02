import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The event catalog, person/screen property shapes, and AnalyticsAdapter
 * interface are shared by the Next app and the Expo app, which cannot share
 * a build. There are two copies of this file and nothing but this test keeps
 * them the same. When they drift, an event typed on one platform silently
 * stops matching the other's catalog.
 *
 * If this fails, copy src/lib/analytics-events.ts over
 * apps/mobile/lib/analytics-events.ts (or the reverse). Fix the file, not the
 * test.
 */
describe("analytics-events parity between the server and the phone", () => {
  it("keeps the two copies byte-for-byte identical", () => {
    const root = join(__dirname, "..");
    const server = readFileSync(join(root, "src/lib/analytics-events.ts"), "utf8");
    const phone = readFileSync(join(root, "apps/mobile/lib/analytics-events.ts"), "utf8");
    expect(phone).toBe(server);
  });
});
