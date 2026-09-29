import { describe, expect, it, vi } from "vitest";
import { DRAFTER_MODEL } from "@/lib/anthropic";
import { proseCheckSystemFor } from "@/lib/prompts";
import {
  CRAFT_FINDINGS_MAX,
  checkDraft,
  craftCheckRequest,
  findDashes,
  findRepeatedOpenings,
  formatCraftCheck,
  mechanicalFindings,
  parseCraftFindings,
} from "@/lib/prose-tells";

function clientReplying(text: string) {
  const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text }] });
  return { create, client: { messages: { create } } as never };
}

const PASSAGE = `The rain came down on the harbor as if the sky itself were grieving. Mara stood at the rail.

She noted the door. She noted the lock on it. She filed both away.

"It's not a line. It's just what I think," Cole said.`;

describe("mechanical checks", () => {
  it("quotes each sentence with a dash, verbatim", () => {
    const text = "He left\u2014fast. Then she came back. The war -- long over -- still mattered. A well-known road.";
    const found = findDashes(text);
    expect(found.map((f) => f.quote)).toEqual(["He left\u2014fast.", "The war -- long over -- still mattered."]);
    for (const f of found) expect(text).toContain(f.quote);
  });

  it("skips dashes entirely when the author allows them", () => {
    const text = "He left\u2014fast.";
    expect(mechanicalFindings(text, { kind: "novel", emDashes: true })).toEqual([]);
    expect(mechanicalFindings(text, { kind: "novel", emDashes: false })).toHaveLength(1);
  });

  it("flags three narration sentences in a row that open on the same word", () => {
    const [finding] = findRepeatedOpenings(PASSAGE);
    expect(finding.quote).toBe("She noted the door. She noted the lock on it. She filed both away.");
    expect(finding.habit).toBe("repeated openings");
    expect(finding.note).toContain('open with "She"');
  });

  it("leaves two in a row, and dialogue, alone", () => {
    expect(findRepeatedOpenings("She ran. She hid. Then the door opened.")).toEqual([]);
    expect(
      findRepeatedOpenings('"No." "No, I said." "No means no." She laughed.')
    ).toEqual([]);
  });

  it("does not read screenplay elements as sentences", () => {
    const script = "MARA\nShe runs.\nShe hides.\nShe waits.";
    expect(mechanicalFindings(script, { kind: "screenplay", emDashes: false })).toEqual([]);
  });
});

describe("model findings", () => {
  const reply = (findings: unknown[]) => JSON.stringify({ findings });

  it("keeps only verbatim quotes with a known habit", () => {
    const found = parseCraftFindings(
      reply([
        {
          quote: "as if the sky itself were grieving",
          habit: "mirrored mood",
          note: "Let Mara's action carry the grief.",
        },
        { quote: "the sky was grieving", habit: "mirrored mood", note: "Paraphrased." },
        { quote: "Mara stood at the rail.", habit: "made-up habit", note: "Unknown." },
        { quote: "Mara stood at the rail.", habit: "Tidy Ending", note: "Case-insensitive name." },
      ]),
      PASSAGE,
      "novel"
    );
    expect(found).toEqual([
      {
        quote: "as if the sky itself were grieving",
        habit: "mirrored mood",
        note: "Let Mara's action carry the grief.",
      },
      { quote: "Mara stood at the rail.", habit: "tidy ending", note: "Case-insensitive name." },
    ]);
  });

  it("returns nothing for a reply that is not the expected JSON", () => {
    expect(parseCraftFindings("not json", PASSAGE, "novel")).toEqual([]);
    expect(parseCraftFindings('{"items":[]}', PASSAGE, "novel")).toEqual([]);
  });

  it("asks the drafter model at low effort with the kind's check prompt", () => {
    const request = craftCheckRequest("Some prose.", "novel", "Brief text");
    expect(request?.model).toBe(DRAFTER_MODEL);
    expect(request?.system).toBe(proseCheckSystemFor("novel"));
    expect((request as { output_config: { effort: string } }).output_config.effort).toBe("low");
    expect(String(request?.messages[0].content)).toContain("<brief>\nBrief text\n</brief>");
    expect(craftCheckRequest("Some prose.", "journal")).toBeNull();
  });
});

describe("checkDraft", () => {
  it("puts model findings first, then mechanical ones, without duplicates", async () => {
    const { create, client } = clientReplying(
      JSON.stringify({
        findings: [
          { quote: "as if the sky itself were grieving", habit: "mirrored mood", note: "Show it." },
        ],
      })
    );
    const found = await checkDraft(`${PASSAGE}\nHe went\u2014gone.`, {
      kind: "novel",
      emDashes: false,
      brief: "Brief",
      client,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(found.map((f) => f.habit)).toEqual(["mirrored mood", "em dash", "repeated openings"]);
    expect(found.length).toBeLessThanOrEqual(CRAFT_FINDINGS_MAX);
  });

  it("keeps the mechanical findings when the model call fails", async () => {
    const create = vi.fn().mockRejectedValue(new Error("overloaded"));
    const found = await checkDraft("He went\u2014gone.", {
      kind: "novel",
      emDashes: false,
      client: { messages: { create } } as never,
    });
    expect(found.map((f) => f.habit)).toEqual(["em dash"]);
  });

  it("skips the model when asked to, and for a journal", async () => {
    const { create, client } = clientReplying('{"findings":[]}');
    await checkDraft(PASSAGE, { kind: "novel", emDashes: false, model: false, client });
    await checkDraft(PASSAGE, { kind: "journal", emDashes: false, client });
    expect(create).not.toHaveBeenCalled();
  });

  it("returns nothing for an empty passage", async () => {
    const { create, client } = clientReplying('{"findings":[]}');
    expect(await checkDraft("  ", { kind: "novel", emDashes: false, client })).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("formatCraftCheck", () => {
  it("is empty with no findings and a quoted list otherwise", () => {
    expect(formatCraftCheck([])).toBe("");
    expect(formatCraftCheck([{ quote: "a b", habit: "em dash", note: "Fix it." }])).toBe(
      "CRAFT CHECK (fix each in your edit, or keep it when it is the author's voice or the brief asked for it):\n" +
        '- [em dash] "a b" - Fix it.'
    );
  });
});
