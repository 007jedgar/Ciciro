import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/anthropic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/anthropic")>()),
  hasAnthropicKey: () => true,
  getAnthropic: () => ({ messages: { create: mocks.create } }),
}));

import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { writeBibleFile } from "@/lib/bible";
import { EM_DASH_STYLE_LINE } from "@/lib/craft-defaults";
import { drafterSystemFor, proseCheckSystemFor } from "@/lib/prompts";
import { executeEditorTool } from "@/lib/tools";
import { runAutoWrite } from "@/lib/autowrite";

type Request = Anthropic.MessageCreateParamsNonStreaming;

const DRAFT = "The rain fell as if the sky were grieving. Mara ran\u2014fast.";
const EDITED = "Mara ran. The rain did not care.";
const CHECK_REPLY = JSON.stringify({
  findings: [
    { quote: "as if the sky were grieving", habit: "mirrored mood", note: "Let Mara carry the grief." },
  ],
});
const PLAN = JSON.stringify({
  beats: [{ goal: "Mara runs for the harbor", brief: "POV close third, past. Mara runs.", wordTarget: 120 }],
  openQuestions: [],
});

function text(t: string) {
  return { content: [{ type: "text", text: t }], stop_reason: "end_turn" };
}

/** Answer each call by what it is: plan, beat edit, craft check, or draft. */
function routeCalls() {
  mocks.create.mockImplementation(async (req: Request) => {
    if (Array.isArray(req.system)) {
      const content = String(req.messages[0].content);
      return text(content.includes("Plan the drafting") ? PLAN : EDITED);
    }
    if (req.system === proseCheckSystemFor("novel")) return text(CHECK_REPLY);
    return text(DRAFT);
  });
}

function calls(): Request[] {
  return mocks.create.mock.calls.map((c) => c[0] as Request);
}

async function seed(style: string) {
  const project = await prisma.project.create({ data: { title: "Tides" } });
  await writeBibleFile(project.id, "style.md", style);
  return project;
}

describe("craft check after a draft", () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
    mocks.create.mockReset();
    routeCalls();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("drafts with the craft defaults and hands the editor a verified CRAFT CHECK", async () => {
    const project = await seed(`# Style\n${EM_DASH_STYLE_LINE}\n`);
    const result = await executeEditorTool(
      "dispatch_draft",
      { brief: "Mara runs for the harbor." },
      { projectId: project.id }
    );

    const [draft, check] = calls();
    expect(draft.system).toBe(drafterSystemFor("novel"));
    expect(draft.system).toContain("Craft defaults");
    expect(check.system).toBe(proseCheckSystemFor("novel"));
    expect(String(check.messages[0].content)).toContain(DRAFT);

    expect(result.content.startsWith(DRAFT)).toBe(true);
    expect(result.content).toContain("CRAFT CHECK");
    expect(result.content).toContain('- [mirrored mood] "as if the sky were grieving" - Let Mara carry the grief.');
    expect(result.content).toContain('- [em dash] "Mara ran\u2014fast."');
  });

  it("lets the author's style.md switch the dash ban off", async () => {
    const project = await seed("# Style\n- Em dashes: allowed\n");
    const result = await executeEditorTool(
      "dispatch_draft",
      { brief: "Mara runs." },
      { projectId: project.id }
    );
    expect(calls()[0].system).toBe(drafterSystemFor("novel", { emDashes: true }));
    expect(calls()[0].system).not.toContain("Never use em dashes");
    expect(result.content).not.toContain("[em dash]");
  });

  it("runs only the mechanical checks for the fast drafter", async () => {
    const project = await seed(`# Style\n${EM_DASH_STYLE_LINE}\n`);
    const result = await executeEditorTool(
      "dispatch_draft",
      { brief: "Mara runs.", mode: "fast" },
      { projectId: project.id }
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(result.content).toContain('- [em dash] "Mara ran\u2014fast."');
    expect(result.content).not.toContain("[mirrored mood]");
  });

  it("passes the check to the editor when auto-draft edits a beat", async () => {
    const project = await seed(`# Style\n${EM_DASH_STYLE_LINE}\n`);
    const chapter = await prisma.chapter.create({
      data: { projectId: project.id, title: "One", order: 0, content: "" },
    });
    const events: Record<string, unknown>[] = [];
    await runAutoWrite({
      projectId: project.id,
      chapterId: chapter.id,
      targetWords: 120,
      guidance: "",
      emit: (e) => events.push(e),
      shouldStop: () => false,
    });

    const edit = calls().find(
      (r) => Array.isArray(r.system) && String(r.messages[0].content).includes("editing one drafted beat")
    );
    const instruction = String(edit?.messages[0].content);
    expect(instruction).toContain(`<draft>\n${DRAFT}\n</draft>`);
    expect(instruction).toMatch(/CRAFT CHECK[\s\S]*mirrored mood[\s\S]*em dash[\s\S]*Return ONLY/);

    const saved = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
    expect(saved.content).toContain(EDITED);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});
