import i18n from "../lib/i18n";
import en from "../lib/i18n/locales/en";
import { MANUSCRIPT_KINDS } from "../lib/manuscript-kind";
import { headlineLines, welcomeCopy } from "../lib/welcome-copy";
import {
  CARD_ROLES,
  HEADLINE_BLINK_MS,
  WELCOME_KINDS,
  diffEdit,
  graphemes,
  headlineSentence,
  initialFrame,
  settledFrame,
  welcomeSteps,
  type WelcomeFrame,
  type WelcomeStep,
} from "../lib/welcome-script";

const LOCALES = ["en", "es", "hi", "zh"] as const;

async function copyFor(locale: (typeof LOCALES)[number]) {
  await i18n.changeLanguage(locale);
  return welcomeCopy((key, options) => i18n.t(key, options));
}

function take(copy: Awaited<ReturnType<typeof copyFor>>, count: number): WelcomeStep[] {
  const steps: WelcomeStep[] = [];
  const gen = welcomeSteps(copy);
  for (let i = 0; i < count; i += 1) steps.push(gen.next().value);
  return steps;
}

const sentence = (f: WelcomeFrame) => `${f.headline.before}${f.headline.word}${f.headline.after}`;

describe("graphemes", () => {
  it("keeps a Devanagari syllable together", () => {
    expect(graphemes("किताब")).toEqual(["कि", "ता", "ब"]);
    expect(graphemes("क्षत्रिय")).toEqual(["क्ष", "त्रि", "य"]);
  });

  it("splits plain text a letter at a time", () => {
    expect(graphemes("abc")).toEqual(["a", "b", "c"]);
    expect(graphemes("写下")).toEqual(["写", "下"]);
  });
});

describe("diffEdit", () => {
  it("finds the one edit between two strings", () => {
    expect(diffEdit("Write the ", "Keep writing the ")).toEqual({ at: 0, deleted: "Write", inserted: "Keep writing" });
    expect(diffEdit(" you keep meaning to.", " you’ve been meaning to.")).toEqual({
      at: 4,
      deleted: " keep",
      inserted: "’ve been",
    });
  });

  it("handles a pure insertion and no change", () => {
    expect(diffEdit("写下你一直想写的", "继续写下你一直想写的")).toEqual({ at: 0, deleted: "", inserted: "继续" });
    expect(diffEdit("same", "same")).toBeNull();
  });
});

describe("the welcome copy", () => {
  afterAll(() => i18n.changeLanguage("en"));

  it("loops through every kind of manuscript", () => {
    expect([...WELCOME_KINDS].sort()).toEqual([...MANUSCRIPT_KINDS].sort());
    expect(WELCOME_KINDS[0]).toBe("novel");
  });

  it.each(LOCALES)("has a word and a page of the right shape for every kind in %s", async (locale) => {
    const copy = await copyFor(locale);
    for (const kind of MANUSCRIPT_KINDS) {
      expect(copy.words[kind].length).toBeGreaterThan(0);
      expect(copy.cards[kind].label.length).toBeGreaterThan(0);
      expect(copy.cards[kind].blocks).toHaveLength(CARD_ROLES[kind].length);
      for (const block of copy.cards[kind].blocks) expect(block.length).toBeGreaterThan(0);
    }
    expect(headlineLines((key) => i18n.t(key))).toBeGreaterThanOrEqual(1);
  });

  it("opens on the sentence from the brief in English", async () => {
    const copy = await copyFor("en");
    expect(`${copy.before}${copy.words.novel}${copy.after}`).toBe("Write the book you keep meaning to.");
    expect(headlineSentence(copy)).toBe("Keep writing the book you’ve been meaning to.");
    expect(en.welcome.headline.words.novel).toBe("book");
  });
});

describe("welcomeSteps", () => {
  afterAll(() => i18n.changeLanguage("en"));

  it.each(LOCALES)("rewrites the headline, then visits every kind, in %s", async (locale) => {
    const copy = await copyFor(locale);
    const steps = take(copy, 6000);

    // The first frames type the novel page, a few letters at a time, with the caret in its block.
    expect(steps[0].frame.card.kind).toBe("novel");
    expect(steps[0].frame.card.caret).toBe(0);
    const novel = settledFrame(copy, "novel").card.typed;
    const typedNovel = steps.find((s) => s.frame.card.typed.join("|") === novel.join("|"));
    expect(typedNovel).toBeDefined();

    // The headline is rewritten before any other kind appears: the first time the word changes, the sentence is final.
    const firstWordChange = steps.find((s) => s.frame.headline.word !== copy.words.novel)!;
    expect(firstWordChange.frame.headline.before).toBe(copy.beforeFinal);
    expect(firstWordChange.frame.headline.after).toBe(copy.afterFinal);

    // Each kind's word is typed in full and its page is typed in full, in loop order.
    const seenKinds: string[] = [];
    for (const step of steps) {
      const card = step.frame.card;
      const done = card.typed.length === CARD_ROLES[card.kind].length && card.caret === null && !card.selected;
      const full = settledFrame(copy, card.kind).card.typed.join("|") === card.typed.join("|");
      if (done && full && step.frame.headline.word === copy.words[card.kind] && seenKinds[seenKinds.length - 1] !== card.kind) {
        seenKinds.push(card.kind);
      }
    }
    expect(seenKinds.slice(0, 6)).toEqual(["novel", "journal", "screenplay", "blog", "novel", "journal"]);
  });

  it("highlights the old page, then deletes it, before typing the next", async () => {
    const copy = await copyFor("en");
    const steps = take(copy, 3000);
    const highlighted = steps.findIndex((s) => s.frame.card.selected);
    expect(highlighted).toBeGreaterThan(0);
    expect(steps[highlighted].frame.card.typed.join("")).toBe(copy.cards.novel.blocks.join(""));
    const gone = steps.findIndex((s, i) => i > highlighted && s.frame.card.typed.length === 0);
    expect(gone).toBeGreaterThan(highlighted);
    expect(steps[gone].frame.card.selected).toBe(false);
    expect(steps[gone + 5].frame.card.kind).toBe("journal");
  });

  it("highlights the words it is about to replace in the headline", async () => {
    const copy = await copyFor("en");
    const steps = take(copy, 3000);
    const selected = steps.filter((s) => s.frame.headline.selection);
    const texts = selected.map((s) => {
      const sel = s.frame.headline.selection!;
      return s.frame.headline[sel.part].slice(sel.from, sel.to);
    });
    expect(texts[0]).toBe("Write");
    expect(texts.some((t) => t === " keep")).toBe(true);
  });

  it("types the sentence into the headline a letter at a time and always reads sensibly", async () => {
    const copy = await copyFor("en");
    const steps = take(copy, 3000);
    for (const step of steps) {
      const h = step.frame.headline;
      expect(sentence(step.frame).length).toBeGreaterThan(10);
      if (h.caret) expect(h.caret.at).toBeLessThanOrEqual(h[h.caret.part].length);
      if (h.selection) expect(h.selection.to).toBeLessThanOrEqual(h[h.selection.part].length);
    }
  });

  it("starts from the initial frame's headline", async () => {
    const copy = await copyFor("en");
    const first = initialFrame(copy);
    expect(sentence(first)).toBe("Write the book you keep meaning to.");
    expect(first.card.typed).toEqual([""]);
    expect(first.card.caret).toBe(0);
  });

  it("keeps a caret in the card from the hand-off until the first letters land", async () => {
    const copy = await copyFor("en");
    const [first, second] = take(copy, 2);
    expect(first.frame.card.typed[first.frame.card.caret!]).toBe("");
    expect(second.frame.card.typed[0].length).toBeGreaterThan(0);
  });

  it.each(LOCALES)("lets the caret blink at the end of the headline before it goes back, in %s", async (locale) => {
    const copy = await copyFor(locale);
    const steps = take(copy, 3000);
    const blinking = steps.findIndex((s) => s.frame.headline.blink && s.frame.headline.caret?.part === "after");
    expect(blinking).toBeGreaterThan(0);
    expect(steps[blinking].frame.headline.caret!.at).toBe(copy.after.length);
    expect(steps[blinking + 1].wait).toBe(HEADLINE_BLINK_MS);
    expect(steps[blinking + 1].frame.headline.blink).toBe(false);
  });
});
