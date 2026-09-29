import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), hasKey: true }));

vi.mock("@/lib/anthropic", () => ({
  DRAFTER_MODEL: "claude-sonnet-5-5",
  DRAFTER_FAST_MODEL: "claude-haiku-4-5",
  hasAnthropicKey: () => mocks.hasKey,
  getAnthropic: () => ({ messages: { create: mocks.create } }),
}));

import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { createCharacter } from "@/lib/story";
import { ensureBible } from "@/lib/bible";
import { EM_DASH_STYLE_LINE } from "@/lib/craft-defaults";
import {
  analyzeStyle,
  excerptWords,
  pickSampleChapters,
  type ChapterForSample,
} from "@/lib/style-analysis";
import {
  parseStyleAnalysisJson,
  quoteAppearsIn,
  ANALYZED_STYLE_HEADING,
  mergeProposedStyleMd,
  renderProposedStyleMd,
  replaceVoiceSection,
  STYLE_TRAIT_ORDER,
} from "@/lib/style-analysis-view";

const reply = (text: string) => ({ content: [{ type: "text", text }] });

describe("pickSampleChapters", () => {
  const chapter = (i: number): ChapterForSample => ({ id: `c${i}`, title: `Ch ${i}`, text: `word${i}` });

  it("returns every chapter with prose when there are few enough", () => {
    const chapters = [chapter(0), chapter(1), chapter(2)];
    expect(pickSampleChapters(chapters, 5).map((c) => c.id)).toEqual(["c0", "c1", "c2"]);
  });

  it("drops chapters with no prose before sampling", () => {
    const chapters = [chapter(0), { id: "empty", title: "Empty", text: "   " }, chapter(1)];
    expect(pickSampleChapters(chapters, 5).map((c) => c.id)).toEqual(["c0", "c1"]);
  });

  it("spreads a deterministic, evenly-spaced sample across a long manuscript", () => {
    const chapters = Array.from({ length: 8 }, (_, i) => chapter(i));
    const picked = pickSampleChapters(chapters, 5).map((c) => c.id);
    expect(picked).toEqual(["c0", "c2", "c4", "c5", "c7"]);
    expect(new Set(picked).size).toBe(5);
  });

  it("always includes the first and last chapter", () => {
    const chapters = Array.from({ length: 20 }, (_, i) => chapter(i));
    const picked = pickSampleChapters(chapters, 5);
    expect(picked[0].id).toBe("c0");
    expect(picked[picked.length - 1].id).toBe("c19");
  });
});

describe("excerptWords", () => {
  it("returns short text unchanged", () => {
    expect(excerptWords("one two three", 10)).toBe("one two three");
  });

  it("truncates long text to the word cap with an ellipsis", () => {
    const text = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ");
    const out = excerptWords(text, 5);
    expect(out).toBe("w0 w1 w2 w3 w4 …");
  });
});

describe("quoteAppearsIn", () => {
  it("matches ignoring case and whitespace differences", () => {
    expect(quoteAppearsIn("Never   Asked", "she never asked for this")).toBe(true);
  });

  it("matches straight quotes and apostrophes against curly ones in the prose", () => {
    const prose = "\u201CI don\u2019t know,\u201D she said.";
    expect(quoteAppearsIn(`"I don't know," she said`, prose)).toBe(true);
    expect(quoteAppearsIn("don\u2019t know", "I don't know")).toBe(true);
  });

  it("rejects a quote that is not in the sample", () => {
    expect(quoteAppearsIn("something invented", "she never asked for this")).toBe(false);
  });

  it("rejects a quote that is too short to mean anything", () => {
    expect(quoteAppearsIn("a", "a b c")).toBe(false);
  });
});

describe("parseStyleAnalysisJson", () => {
  const sampleText = 'Mara said, "I never asked for this." He never raised his voice, not once.';
  const characterNames = ["Cole", "Mara"];

  function validJson() {
    return JSON.stringify({
      traits: [
        { category: "pov", text: "Close third person.", quote: "Mara said" },
        { category: "tense", text: "Past tense throughout.", quote: "never asked for this" },
        { category: "dialogueConventions", text: "Spare tags.", quote: "a fabricated quote not in the sample" },
        { category: "unknownCategory", text: "ignored", quote: "" },
      ],
      characters: [
        { name: "Cole", voice: "Terse, repeats himself.", quote: "not once" },
        { name: "Nobody", voice: "Should be dropped.", quote: "Mara said" },
      ],
    });
  }

  it("keeps only known categories, in the fixed trait order", () => {
    const out = parseStyleAnalysisJson(validJson(), { sampleText, characterNames });
    expect(out?.traits.map((t) => t.category)).toEqual(["pov", "tense", "dialogueConventions"]);
  });

  it("keeps an avoids trait that describes an absence", () => {
    const raw = JSON.stringify({
      traits: [
        {
          category: "avoids",
          text: "No evidence of adverbs or exclamation points anywhere; the prose stays flat.",
          quote: "",
        },
        { category: "diction", text: "No evidence in the excerpts.", quote: "" },
      ],
      characters: [],
    });
    const out = parseStyleAnalysisJson(raw, { sampleText, characterNames });
    expect(out?.traits.map((t) => t.category)).toEqual(["avoids"]);
  });

  it("drops a trait the model had no evidence for instead of keeping a placeholder", () => {
    const raw = JSON.stringify({
      traits: [
        { category: "pov", text: "Close third person.", quote: "Mara said" },
        { category: "tense", text: "", quote: "" },
        { category: "diction", text: "Not enough evidence in the excerpts.", quote: "" },
      ],
      characters: [],
    });
    const out = parseStyleAnalysisJson(raw, { sampleText, characterNames });
    expect(out?.traits.map((t) => t.category)).toEqual(["pov"]);
  });

  it("drops a quote that cannot be found verbatim in the sample, but keeps the text", () => {
    const out = parseStyleAnalysisJson(validJson(), { sampleText, characterNames });
    const dialogue = out?.traits.find((t) => t.category === "dialogueConventions");
    expect(dialogue?.text).toBe("Spare tags.");
    expect(dialogue?.quote).toBe("");
  });

  it("keeps a verified quote", () => {
    const out = parseStyleAnalysisJson(validJson(), { sampleText, characterNames });
    expect(out?.traits.find((t) => t.category === "pov")?.quote).toBe("Mara said");
  });

  it("drops a character not in the known list", () => {
    const out = parseStyleAnalysisJson(validJson(), { sampleText, characterNames });
    expect(out?.characters.map((c) => c.name)).toEqual(["Cole"]);
  });

  it("strips code fences before parsing", () => {
    const out = parseStyleAnalysisJson("```json\n" + validJson() + "\n```", { sampleText, characterNames });
    expect(out?.traits.length).toBeGreaterThan(0);
  });

  it("returns null for unparsable text", () => {
    expect(parseStyleAnalysisJson("not json at all", { sampleText, characterNames })).toBeNull();
  });

  it("returns null when traits is missing", () => {
    expect(parseStyleAnalysisJson(JSON.stringify({ characters: [] }), { sampleText, characterNames })).toBeNull();
  });
});

describe("renderProposedStyleMd", () => {
  it("renders one bullet per trait, in fixed order, with a quote line only when present", () => {
    const md = renderProposedStyleMd([
      { category: "tense", text: "Past tense.", quote: "" },
      { category: "pov", text: "Close third.", quote: "she walked" },
    ]);
    const lines = md.trim().split("\n");
    expect(lines[0]).toBe("# Style");
    expect(md).toContain("**POV:** Close third.");
    expect(md).toContain('> "she walked"');
    expect(md.indexOf("POV")).toBeLessThan(md.indexOf("Tense"));
    expect(md).not.toContain('> ""');
  });

  it("covers every declared trait category", () => {
    expect(STYLE_TRAIT_ORDER.length).toBe(7);
  });
});

describe("mergeProposedStyleMd", () => {
  const traits = [
    { category: "pov" as const, text: "Close third person.", quote: "she walked" },
    { category: "tense" as const, text: "Past tense.", quote: "" },
  ];
  const existing =
    '# Style\n> Voice, POV, tense.\n\n- Never use em dashes; use a hyphen "-".\n- Past tense.\n\n## Narrator\n- Mara\n';

  it("drafts the full proposal when there is no style.md yet", () => {
    expect(mergeProposedStyleMd("", traits)).toEqual({
      styleMd: renderProposedStyleMd(traits),
      added: traits,
      suggestions: [],
    });
  });

  it("keeps the existing file intact and adds only traits it doesn't already say", () => {
    const { styleMd, added, suggestions } = mergeProposedStyleMd(existing, traits);
    expect(styleMd.startsWith(existing.trimEnd())).toBe(true);
    expect(added).toEqual([traits[0]]);
    expect(styleMd).toContain(`${ANALYZED_STYLE_HEADING}\n- **POV:** Close third person.\n  > "she walked"`);
    expect(styleMd).not.toContain("**Tense:**");
    expect(suggestions).toEqual([]);
  });

  it("returns the file unchanged when every trait is already there", () => {
    expect(mergeProposedStyleMd(existing, [traits[1]]).styleMd).toBe(existing);
  });

  it("never rewrites a saved bullet; a differing reading becomes a suggestion", () => {
    const previous = `# Style\n- Rule.\n\n${ANALYZED_STYLE_HEADING}\n- **POV:** Close third, never head-hop away from Mara.\n  > "she walked"\n\n## Narrator\n- Mara\n`;
    const reading = { category: "pov" as const, text: "Close third person.", quote: "Mara said" };
    const { styleMd, added, suggestions } = mergeProposedStyleMd(previous, [reading]);
    expect(styleMd).toBe(previous);
    expect(added).toEqual([]);
    expect(suggestions).toEqual([
      { trait: reading, current: "- **POV:** Close third, never head-hop away from Mara." },
    ]);
  });

  it("treats a bullet the author wrote outside the analysis section as covering its category", () => {
    const authored = "# Style\n- **Tense:** Present, always.\n";
    const { styleMd, suggestions } = mergeProposedStyleMd(authored, [traits[1]]);
    expect(styleMd).toBe(authored);
    expect(suggestions.map((sg) => sg.trait.category)).toEqual(["tense"]);
  });

  it("recognizes a hand-written category bullet in plain or starred form", () => {
    for (const authored of [
      "# Style\n- POV: close third, Mara only.\n",
      "# Style\n* **POV:** close third, Mara only.\n",
      "# Style\n- **pov**: close third, Mara only.\n",
    ]) {
      const { styleMd, suggestions } = mergeProposedStyleMd(authored, [traits[0]]);
      expect(styleMd).toBe(authored);
      expect(suggestions.map((sg) => sg.trait.category)).toEqual(["pov"]);
    }
  });

  it("appends only new categories to a previous analysis section", () => {
    const previous = `# Style\n- Rule.\n\n${ANALYZED_STYLE_HEADING}\n- **Tense:** Future tense.\n\n## Narrator\n- Mara\n`;
    const { styleMd, suggestions } = mergeProposedStyleMd(previous, traits);
    expect(styleMd.split(ANALYZED_STYLE_HEADING)).toHaveLength(2);
    expect(styleMd).toBe(
      `# Style\n- Rule.\n\n${ANALYZED_STYLE_HEADING}\n- **Tense:** Future tense.\n- **POV:** Close third person.\n  > "she walked"\n\n## Narrator\n- Mara\n`
    );
    expect(suggestions.map((sg) => sg.trait.category)).toEqual(["tense"]);
  });
});

describe("replaceVoiceSection", () => {
  it("replaces an existing Voice section, preserving what comes before and after", () => {
    const file = [
      "# Aiden",
      "> protagonist",
      "",
      "## Description",
      "A quiet man.",
      "",
      "## Voice",
      "> How they speak: diction, rhythm, tics.",
      "- old notes",
      "",
      "## Notes",
      "- unrelated",
    ].join("\n");
    const out = replaceVoiceSection(file, "Clipped sentences. Never says \"okay.\"");
    expect(out).toContain("## Description\nA quiet man.");
    expect(out).toContain('## Voice\nClipped sentences. Never says "okay."');
    expect(out).not.toContain("old notes");
    expect(out).toContain("## Notes\n- unrelated");
  });

  it("appends a Voice section when the file has none", () => {
    const file = "# Aiden\n> protagonist\n\n## Description\nA quiet man.\n";
    const out = replaceVoiceSection(file, "Clipped sentences.");
    expect(out).toContain("## Description\nA quiet man.");
    expect(out.trim().endsWith("## Voice\nClipped sentences.")).toBe(true);
  });
});

describe("analyzeStyle", () => {
  beforeEach(async () => {
    mocks.create.mockReset();
    mocks.hasKey = true;
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedManuscript() {
    const user = await registerUser({ email: "ada@example.com", password: "long-enough-pw" });
    const project = await createProject(user, { title: "Tides" });
    const chapter = await prisma.chapter.findFirstOrThrow({ where: { projectId: project.id } });
    await prisma.chapter.update({
      where: { id: chapter.id },
      data: {
        title: "The Pier",
        content: `<p>Mara said, "I never asked for this." ${Array.from({ length: 90 }, () => "tide").join(" ")}</p>`,
      },
    });
    const second = await prisma.chapter.create({
      data: {
        projectId: project.id,
        title: "The Storm",
        order: chapter.order + 1,
        content: `<p>He never raised his voice, not once. ${Array.from({ length: 90 }, () => "moon").join(" ")}</p>`,
      },
    });
    const third = await prisma.chapter.create({
      data: {
        projectId: project.id,
        title: "The Return",
        order: second.order + 1,
        content: `<p>"Stay," Cole said, "just stay." ${Array.from({ length: 90 }, () => "storm").join(" ")}</p>`,
      },
    });
    await createCharacter(user, { projectId: project.id, name: "Cole", role: "love interest" });
    await ensureBible(project.id);
    return { user, project, chapters: [chapter, second, third] };
  }

  it("drafts a verified proposal and drops a character not in the bible", async () => {
    const { user, project } = await seedManuscript();
    mocks.create.mockResolvedValue(
      reply(
        JSON.stringify({
          traits: [
            { category: "pov", text: "Close third person.", quote: "Mara said" },
            { category: "tense", text: "Past tense throughout.", quote: "never asked for this" },
            { category: "sentenceRhythm", text: "Short, clipped sentences.", quote: "not once" },
            { category: "diction", text: "Plain, concrete words.", quote: "stay" },
            {
              category: "dialogueConventions",
              text: "Dialogue tags are spare.",
              quote: "a completely fabricated line",
            },
            { category: "recurringDevices", text: "Weather imagery recurs.", quote: "storm" },
            { category: "avoids", text: "Avoids adverbs.", quote: "" },
          ],
          characters: [
            { name: "Cole", voice: "Terse and commanding, repeats himself for emphasis.", quote: "just stay" },
            { name: "Nobody", voice: "Should be dropped, unknown name.", quote: "tide" },
          ],
        })
      )
    );

    const proposal = await analyzeStyle(project.id, user);

    expect(proposal.traits.map((t) => t.category)).toEqual(STYLE_TRAIT_ORDER);
    expect(proposal.traits.find((t) => t.category === "dialogueConventions")?.quote).toBe("");
    expect(proposal.traits.find((t) => t.category === "recurringDevices")?.quote).toBe("storm");
    expect(proposal.characters).toHaveLength(1);
    expect(proposal.characters[0]).toMatchObject({
      name: "Cole",
      path: "characters/cole.md",
      quote: "just stay",
      currentRevision: 0,
    });
    expect(proposal.characters[0].currentContent).toContain("## Voice");
    expect(proposal.proposedStyleMd).toContain("# Style");
    expect(proposal.proposedStyleMd.startsWith(proposal.currentStyleMd.trimEnd())).toBe(true);
    expect(proposal.proposedStyleMd).toContain(EM_DASH_STYLE_LINE);
    expect(proposal.proposedStyleMd).toContain(`${ANALYZED_STYLE_HEADING}\n- **POV:** Close third person.`);
    expect(proposal.styleSuggestions).toEqual([]);
    expect(proposal.sampledChapters.map((c) => c.title).sort()).toEqual(
      ["The Pier", "The Return", "The Storm"].sort()
    );

    const sent = mocks.create.mock.calls[0][0];
    expect(sent.model).toBe("claude-sonnet-5-5");
    expect(sent.messages[0].content).toContain("Mara said");
    expect(sent.messages[0].content).toContain("Named characters: Cole");
    // Sonnet 5.5 migration: the request omits `thinking` (adaptive by
    // default, unchanged from Sonnet 5) rather than disabling it, and
    // carries none of the params the migration dropped (`budget_tokens`,
    // a forced `tool_choice`).
    expect(sent.thinking).toBeUndefined();
    expect(sent.budget_tokens).toBeUndefined();
    expect(sent.tool_choice).toBeUndefined();
  });

  it("refuses without enough written prose, without calling the model", async () => {
    const user = await registerUser({ email: "ada@example.com", password: "long-enough-pw" });
    const project = await createProject(user, { title: "Blank Page" });
    await expect(analyzeStyle(project.id, user)).rejects.toMatchObject({ status: 400 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses without an API key, without calling the model", async () => {
    const { user, project } = await seedManuscript();
    mocks.hasKey = false;
    await expect(analyzeStyle(project.id, user)).rejects.toMatchObject({ status: 503 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("reports a bad model reply as an error", async () => {
    const { user, project } = await seedManuscript();
    mocks.create.mockResolvedValue(reply("not json"));
    await expect(analyzeStyle(project.id, user)).rejects.toMatchObject({ status: 502 });
  });

  it("refuses another author's manuscript", async () => {
    const { project } = await seedManuscript();
    const other = await registerUser({ email: "bob@example.com", password: "long-enough-pw" });
    await expect(analyzeStyle(project.id, other)).rejects.toMatchObject({ status: 403 });
  });
});
