import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/anthropic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/anthropic")>()),
  hasAnthropicKey: () => true,
  getAnthropic: () => ({ messages: { create: mocks.create } }),
}));

import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { updateUserSettings } from "@/lib/user-settings";
import { writeBibleFile } from "@/lib/bible";
import { EM_DASH_STYLE_LINE } from "@/lib/craft-defaults";
import { AUTONOMOUS_DIRECTIVE, drafterSystemFor, editorSystemFor, proseCheckSystemFor } from "@/lib/prompts";
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

/** A project whose owner has the "Experimental writing prompt" setting on or off. */
async function seed(style: string, craftDefaults = true) {
  const owner = await registerUser({ email: "mara@example.com", password: "long-enough-pw" });
  if (craftDefaults) await updateUserSettings(owner.id, { craftDefaults });
  const project = await prisma.project.create({ data: { title: "Tides", userId: owner.id } });
  await writeBibleFile(project.id, "style.md", style);
  return project;
}

async function autoDraft(projectId: string) {
  const chapter = await prisma.chapter.create({
    data: { projectId, title: "One", order: 0, content: "" },
  });
  const events: Record<string, unknown>[] = [];
  await runAutoWrite({
    projectId,
    chapterId: chapter.id,
    targetWords: 120,
    guidance: "",
    emit: (e) => events.push(e),
    shouldStop: () => false,
  });
  return { chapter, events };
}

function beatEdit(): Request | undefined {
  return calls().find(
    (r) => Array.isArray(r.system) && String(r.messages[0].content).includes("editing one drafted beat")
  );
}

describe("craft check after a draft", () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
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
    expect(draft.system).toBe(drafterSystemFor("novel", { craft: true }));
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
    expect(calls()[0].system).toBe(drafterSystemFor("novel", { craft: true, emDashes: true }));
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

  it("passes the brief and the check to the editor when auto-draft edits a beat", async () => {
    const project = await seed(`# Style\n${EM_DASH_STYLE_LINE}\n`);
    const { chapter, events } = await autoDraft(project.id);

    const edit = beatEdit();
    expect(edit?.system).toEqual(editorSystemFor("novel", AUTONOMOUS_DIRECTIVE, { craft: true }));
    const instruction = String(edit?.messages[0].content);
    expect(instruction).toContain(`<draft>\n${DRAFT}\n</draft>`);
    expect(instruction).toContain("<brief>\nPOV close third, past. Mara runs.\n</brief>");
    expect(instruction).toMatch(/<\/brief>\n\nCRAFT CHECK[\s\S]*mirrored mood[\s\S]*em dash[\s\S]*Return ONLY/);

    const saved = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
    expect(saved.content).toContain(EDITED);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  describe("with the Experimental writing prompt setting off (the default)", () => {
    it("dispatch_draft makes one call on the pre-craft prompt and returns the prose alone", async () => {
      const project = await seed(`# Style\n${EM_DASH_STYLE_LINE}\n`, false);
      const result = await executeEditorTool(
        "dispatch_draft",
        { brief: "Mara runs for the harbor." },
        { projectId: project.id }
      );
      expect(mocks.create).toHaveBeenCalledTimes(1);
      expect(calls()[0].system).toBe(drafterSystemFor("novel"));
      expect(calls()[0].system).not.toContain("Craft defaults");
      expect(result.content).toBe(DRAFT);
    });

    it("still lets the author's style.md switch the dash ban off", async () => {
      const project = await seed("# Style\n- Em dashes: allowed\n", false);
      await executeEditorTool("dispatch_draft", { brief: "Mara runs." }, { projectId: project.id });
      expect(calls()[0].system).toBe(drafterSystemFor("novel", { emDashes: true }));
      expect(calls()[0].system).not.toContain("Never use em dashes");
      expect(calls()[0].system).not.toContain("Craft defaults");
    });

    it("auto-draft runs no check and edits each beat on the pre-craft instruction", async () => {
      const project = await seed(`# Style\n${EM_DASH_STYLE_LINE}\n`, false);
      const { chapter, events } = await autoDraft(project.id);

      // Plan, draft, edit: no check call in between.
      expect(calls()).toHaveLength(3);
      expect(calls().some((r) => r.system === proseCheckSystemFor("novel"))).toBe(false);
      for (const r of calls().filter((c) => Array.isArray(c.system))) {
        expect(r.system).toEqual(editorSystemFor("novel", AUTONOMOUS_DIRECTIVE));
        expect(JSON.stringify(r.system)).not.toContain("Craft defaults");
      }
      const instruction = String(beatEdit()?.messages[0].content);
      expect(instruction).not.toContain("CRAFT CHECK");
      expect(instruction).not.toContain("<brief>");
      expect(instruction).toMatch(/<\/draft>\n\nReturn ONLY/);

      const saved = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
      expect(saved.content).toContain(EDITED);
      expect(events.some((e) => e.type === "done")).toBe(true);
    });
  });
});
