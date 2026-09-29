import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { AUTONOMOUS_DIRECTIVE, drafterSystemFor, editorSystemFor } from "@/lib/prompts";
import { JUDGE_SYSTEM, costOf, runDemo, tally, textMetrics } from "../scripts/craft-demo/engine";
import { mockClient } from "../scripts/craft-demo/mock";
import { annotate, renderPage } from "../scripts/craft-demo/render";
import { SCENES } from "../scripts/craft-demo/scenes";

type Req = Anthropic.MessageCreateParamsNonStreaming;

const scene = (id: string) => SCENES.find((s) => s.id === id)!;

function systemText(req: Req): string {
  return Array.isArray(req.system) ? req.system.map((b) => b.text).join("") : String(req.system);
}

describe("craft demo harness", () => {
  it("has distinct scene ids and a style.md for each", () => {
    const ids = SCENES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SCENES) expect(s.styleMd).toMatch(/^# Style/);
  });

  it("runs arm A on the pre-craft prompts and arm B on the craft pipeline", async () => {
    const client = mockClient();
    const kitchen = scene("kitchen");
    const dashes = scene("dash-voice");
    const result = await runDemo({ client, scenes: [kitchen, dashes], samples: 1, dryRun: true, concurrency: 1 });

    const drafts = client.calls.filter((r) => r.model === "claude-sonnet-5-5" && !systemText(r).startsWith("You check"));
    const systems = drafts.map(systemText);
    expect(systems).toContain(drafterSystemFor("novel", { craft: false }));
    expect(systems).toContain(drafterSystemFor("novel"));
    // Only the craft arm honours the author's style.md dash switch.
    expect(systems).toContain(drafterSystemFor("novel", { emDashes: true }));
    expect(systems.filter((s) => s.includes("Em dashes are allowed"))).toHaveLength(1);

    const edits = client.calls.filter((r) => Array.isArray(r.system));
    const baselineEditor = editorSystemFor("novel", AUTONOMOUS_DIRECTIVE, { craft: false })[0].text;
    const craftEditor = editorSystemFor("novel", AUTONOMOUS_DIRECTIVE)[0].text;
    const baselineEdits = edits.filter((r) => systemText(r) === baselineEditor);
    const craftEdits = edits.filter((r) => systemText(r) === craftEditor);
    expect(baselineEdits).toHaveLength(2);
    expect(craftEdits).toHaveLength(2);
    for (const r of baselineEdits) expect(String(r.messages[0].content)).not.toContain("CRAFT CHECK");
    expect(craftEdits.some((r) => String(r.messages[0].content).includes("CRAFT CHECK"))).toBe(true);

    const pair = result.scenes[0].pairs[0];
    expect(pair.judgments.map((j) => j.firstShown)).toEqual(["A", "B"]);
    expect(client.calls.filter((r) => r.system === JUDGE_SYSTEM)).toHaveLength(4);
    expect(pair.B.craftCheck).toContain("mirrored mood");
    expect(pair.A.craftCheck).toBe("");

    expect(result.usage).toHaveLength(client.calls.length);
    const cost = costOf(result.usage);
    expect(cost.total).toBeGreaterThan(0);
    expect(cost.unpriced).toEqual([]);
    const t = tally(result);
    expect(t.quality.A + t.quality.B + t.quality.tie).toBe(4);
  });

  it("maps a judge's passage numbers back to the arm shown in that slot", async () => {
    const base = mockClient();
    const client = {
      messages: {
        create: async (req: Req) => {
          if (req.system !== JUDGE_SYSTEM) return base.messages.create(req);
          // Always prefer passage 1.
          return {
            content: [{ type: "text", text: JSON.stringify({ quality: "1", voice: "2", brief: "tie", reason: "r" }) }],
            stop_reason: "end_turn",
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      },
    } as never;
    const result = await runDemo({ client, scenes: [scene("office")], samples: 1, dryRun: true });
    const [first, second] = result.scenes[0].pairs[0].judgments;
    expect([first.quality, first.voice, first.brief]).toEqual(["A", "B", "tie"]);
    expect([second.quality, second.voice, second.brief]).toEqual(["B", "A", "tie"]);
  });

  it("records a failed arm without judging the pair", async () => {
    const client = {
      messages: {
        create: async () => ({ content: [], stop_reason: "refusal", usage: { input_tokens: 1, output_tokens: 0 } }),
      },
    } as never;
    const result = await runDemo({ client, scenes: [scene("blog")], samples: 1, dryRun: true });
    const pair = result.scenes[0].pairs[0];
    expect(pair.A.error).toMatch(/declined/);
    expect(pair.judgments).toEqual([]);
    expect(renderPage(result)).toContain("Failed: The model declined this request.");
  });
});

describe("craft demo page", () => {
  it("marks findings in order, skipping overlaps, and escapes the prose", () => {
    const html = annotate("A <b> as if grieving. She ran. She hid. She went.", [
      { quote: "She ran. She hid. She went.", habit: "repeated openings", note: "Vary." },
      { quote: "She hid.", habit: "other", note: "Overlaps." },
      { quote: "as if grieving", habit: "mirrored mood", note: 'Say "less".' },
    ]);
    expect(html).toBe(
      '<p>A &lt;b&gt; <mark title="mirrored mood: Say &quot;less&quot;."><span class="tag">mirrored mood</span>as if grieving</mark>. ' +
        '<mark title="repeated openings: Vary."><span class="tag">repeated openings</span>She ran. She hid. She went.</mark></p>'
    );
  });

  it("labels a dry run and renders every scene", async () => {
    const result = await runDemo({ client: mockClient(), scenes: SCENES, samples: 1, dryRun: true });
    const html = renderPage(result);
    expect(html).toContain("<b>Dry run.</b>");
    for (const s of SCENES) expect(html).toContain(`id="${s.id}"`);
    expect(html).toContain("Estimated cost of a real run");
  });

  it("counts dashes, staged contrasts, and sentence lengths", () => {
    const m = textMetrics("It was not fear. It was hunger. She ate.\n\nHe left\u2014fast.");
    expect(m.contrasts).toBe(1);
    expect(m.dashesPer1k).toBeGreaterThan(0);
    expect(m.words).toBe(11);
  });
});
