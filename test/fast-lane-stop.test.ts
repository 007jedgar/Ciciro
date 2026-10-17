import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/anthropic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/anthropic")>()),
  getAnthropic: () => ({ messages: { create: mocks.create } }),
}));

import { runContinuityCompact } from "@/lib/fast-lane";

const reply = (text: string, stop_reason: string) => ({ content: [{ type: "text", text }], stop_reason });

describe("runContinuityCompact", () => {
  beforeEach(() => mocks.create.mockReset());

  it("returns a finished brief", async () => {
    mocks.create.mockResolvedValue(reply("Mara has the letter.", "end_turn"));
    await expect(runContinuityCompact("transcript")).resolves.toBe("Mara has the letter.");
  });

  it.each(["refusal", "max_tokens"])("rejects a brief that stopped at %s", async (stop) => {
    mocks.create.mockResolvedValue(reply("Mara has the le", stop));
    await expect(runContinuityCompact("transcript")).rejects.toThrow(stop);
  });
});
