import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/anthropic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/anthropic")>()),
  hasAnthropicKey: () => true,
  getAnthropic: () => ({ messages: { create: mocks.create } }),
}));

import { prisma } from "@/lib/db";
import { executeEditorTool } from "@/lib/tools";

const reply = (text: string, stop_reason = "end_turn") => ({
  content: [{ type: "text", text }],
  stop_reason,
});

describe("dispatch_draft", () => {
  beforeEach(async () => {
    mocks.create.mockReset();
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns the draft plainly when it finishes within its token limit", async () => {
    const project = await prisma.project.create({ data: { title: "Tides" } });
    mocks.create.mockResolvedValue(reply("Mara ran for the harbor."));

    const result = await executeEditorTool("dispatch_draft", { brief: "Mara runs." }, { projectId: project.id });

    expect(result.content).toBe("Mara ran for the harbor.");
    expect(mocks.create.mock.calls[0][0].max_tokens).toBeGreaterThanOrEqual(16000);
  });

  it("tells the editor when the drafter was cut off at its token limit", async () => {
    const project = await prisma.project.create({ data: { title: "Tides" } });
    mocks.create.mockResolvedValue(reply("Mara ran for the", "max_tokens"));

    const result = await executeEditorTool("dispatch_draft", { brief: "Mara runs." }, { projectId: project.id });

    expect(result.content).toBe(
      "Mara ran for the\n\n(The drafter hit its length limit, so this draft stops mid-passage. Finish or trim it in your edit.)"
    );
  });
});
