import {
  EXERCISE_IDS,
  EXERCISES,
  emptyTexts,
  exerciseById,
  exerciseCopyText,
  exerciseHtml,
  exerciseMinutes,
  exerciseWordCount,
  fractionOf,
  hasWriting,
  isExerciseId,
  namesParts,
  nextPart,
  partMs,
  partsBefore,
  settleMs,
  settlePromptAt,
  totalWords,
  type ExerciseDef,
} from "../lib/writing-exercise";
import en from "../lib/i18n/locales/en";
import es from "../lib/i18n/locales/es";
import hi from "../lib/i18n/locales/hi";
import zh from "../lib/i18n/locales/zh";

const LOCALES = { en, es, hi, zh } as const;

function must(id: string): ExerciseDef {
  const exercise = exerciseById(id);
  if (!exercise) throw new Error(`no exercise ${id}`);
  return exercise;
}

/** A dotted key's value in a locale, or undefined when any step is missing. */
function lookup(locale: object, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], locale);
}

describe("the exercise registry", () => {
  it("lists every exercise once, in the order the picker shows them", () => {
    expect(EXERCISES.map((exercise) => exercise.id)).toEqual([...EXERCISE_IDS]);
    expect(new Set(EXERCISE_IDS).size).toBe(EXERCISE_IDS.length);
    expect(EXERCISE_IDS[0]).toBe("observe_react_narrate");
  });

  it("keeps the ids analytics already carries", () => {
    expect(EXERCISE_IDS).toContain("observe_react_narrate");
    expect(isExerciseId("one_true_sentence")).toBe(true);
    expect(isExerciseId("nope")).toBe(false);
    expect(isExerciseId(undefined)).toBe(false);
    expect(exerciseById("nope")).toBeNull();
    expect(exerciseById(undefined)).toBeNull();
  });

  it("gives every exercise parts with unique ids and a soft clock of one to ten minutes", () => {
    for (const exercise of EXERCISES) {
      expect(exercise.parts.length).toBeGreaterThan(0);
      expect(new Set(exercise.parts.map((part) => part.id)).size).toBe(exercise.parts.length);
      for (const part of exercise.parts) {
        expect(Number.isInteger(part.minutes)).toBe(true);
        expect(part.minutes).toBeGreaterThanOrEqual(1);
        expect(part.minutes).toBeLessThanOrEqual(10);
        expect(partMs(part)).toBe(part.minutes * 60_000);
      }
    }
  });

  it("keeps a settle-in short enough to be a breath, and gives every one at least a line", () => {
    for (const exercise of EXERCISES) {
      if (!exercise.settle) continue;
      expect(exercise.settle.prompts.length).toBeGreaterThan(0);
      expect(settleMs(exercise.settle)).toBeGreaterThanOrEqual(15_000);
      expect(settleMs(exercise.settle)).toBeLessThanOrEqual(60_000);
    }
  });

  it("is distinct from Observe, React, Narrate and suits a phone: one to a handful of short parts", () => {
    const fresh = EXERCISES.filter((exercise) => exercise.id !== "observe_react_narrate");
    expect(fresh).toHaveLength(4);
    for (const exercise of fresh) {
      expect(exercise.parts.map((part) => part.id)).not.toEqual(["observe", "react", "narrate"]);
      expect(exerciseMinutes(exercise)).toBeLessThanOrEqual(15);
      expect(exercise.parts.length).toBeLessThanOrEqual(3);
    }
  });

  it("adds up the minutes of the writing parts, without the settle-in", () => {
    expect(exerciseMinutes(must("observe_react_narrate"))).toBe(21);
    expect(exerciseMinutes(must("pour_it_out"))).toBe(10);
    expect(exerciseMinutes(must("one_true_sentence"))).toBe(9);
  });
});

describe("the exercise copy", () => {
  const keysFor = (exercise: ExerciseDef) => {
    const base = `exercise.items.${exercise.id}`;
    const keys = [`${base}.title`, `${base}.tagline`, `${base}.intro`];
    if (exercise.credited) keys.push(`${base}.credit`);
    if (exercise.settle) {
      keys.push(`${base}.settle.hint`, `${base}.settle.open`);
      for (const prompt of exercise.settle.prompts) keys.push(`${base}.settle.prompts.${prompt}`);
    }
    for (const part of exercise.parts) {
      for (const field of ["name", "blurb", "guide", "placeholder", "label"]) {
        keys.push(`${base}.parts.${part.id}.${field}`);
      }
    }
    return keys;
  };

  it.each(Object.keys(LOCALES))("is written for every exercise, part and settle line in %s", (name) => {
    const locale = LOCALES[name as keyof typeof LOCALES];
    for (const exercise of EXERCISES) {
      for (const key of keysFor(exercise)) {
        const value = lookup(locale, key);
        expect(typeof value === "string" && value.trim().length > 0 ? null : key).toBeNull();
      }
    }
  });

  it("carries no copy for an exercise the registry does not list, or an uncredited credit", () => {
    const items = Object.keys((en.exercise as { items: object }).items);
    expect(items.sort()).toEqual([...EXERCISE_IDS].sort());
    for (const exercise of EXERCISES) {
      const item = lookup(en, `exercise.items.${exercise.id}`) as Record<string, unknown>;
      expect("credit" in item).toBe(exercise.credited);
    }
  });

  it("credits the writer whose practice an exercise follows, in every language, and nobody else", () => {
    const named: Record<string, string[]> = {
      pour_it_out: ["Cameron", "Elbow", "Goldberg"],
      one_true_sentence: ["Hemingway"],
      terrible_first_draft: ["Lamott"],
      noun_list: ["Bradbury"],
    };
    for (const [id, names] of Object.entries(named)) {
      for (const locale of Object.values(LOCALES)) {
        const credit = lookup(locale, `exercise.items.${id}.credit`) as string;
        for (const writer of names) expect(credit).toContain(writer);
      }
    }
    const everyWriter = Object.values(named).flat();
    for (const [id, names] of Object.entries(named)) {
      const credit = lookup(en, `exercise.items.${id}.credit`) as string;
      for (const writer of everyWriter.filter((w) => !names.includes(w))) expect(credit).not.toContain(writer);
    }
  });

  it("names the works the credits point at, so a reader can find them", () => {
    const credit = (id: string) => lookup(en, `exercise.items.${id}.credit`) as string;
    expect(credit("pour_it_out")).toContain("The Artist's Way");
    expect(credit("one_true_sentence")).toContain("A Moveable Feast");
    expect(credit("one_true_sentence")).toContain("The Paris Review");
    expect(credit("terrible_first_draft")).toContain("Bird by Bird");
    expect(credit("noun_list")).toContain("Zen in the Art of Writing");
  });

  it("uses no em dashes in any language", () => {
    for (const locale of Object.values(LOCALES)) {
      expect(JSON.stringify(locale.exercise)).not.toContain("—");
    }
  });
});

describe("settle-in clocks", () => {
  const senses = must("observe_react_narrate").settle!;

  it("walks the senses in order and holds the last one to the end", () => {
    expect(senses.prompts).toEqual(["look", "listen", "smell", "feel"]);
    expect(settleMs(senses)).toBe(48_000);
    expect(settlePromptAt(senses, 0)).toBe("look");
    expect(settlePromptAt(senses, senses.promptMs - 1)).toBe("look");
    expect(settlePromptAt(senses, senses.promptMs)).toBe("listen");
    expect(settlePromptAt(senses, senses.promptMs * 3)).toBe("feel");
    expect(settlePromptAt(senses, settleMs(senses) * 2)).toBe("feel");
    expect(settlePromptAt(senses, -5)).toBe("look");
  });

  it("walks any exercise's own lines at its own pace", () => {
    const breath = must("pour_it_out").settle!;
    expect(breath.prompts).toEqual(["breathe", "letGo", "begin"]);
    expect(settlePromptAt(breath, 6_999)).toBe("breathe");
    expect(settlePromptAt(breath, 7_000)).toBe("letGo");
    expect(settlePromptAt(breath, 20_000)).toBe("begin");
  });

  it("starts the exercises that need no warm-up on the page", () => {
    for (const id of ["one_true_sentence", "terrible_first_draft", "noun_list"]) expect(must(id).settle).toBeNull();
  });

  it("clamps progress to the span", () => {
    expect(fractionOf(0, 1000)).toBe(0);
    expect(fractionOf(250, 1000)).toBe(0.25);
    expect(fractionOf(5000, 1000)).toBe(1);
    expect(fractionOf(-1, 1000)).toBe(0);
    expect(fractionOf(10, 0)).toBe(0);
    expect(fractionOf(Number.NaN, 1000)).toBe(0);
  });
});

describe("walking an exercise's parts", () => {
  it("runs observe, react, narrate", () => {
    const orn = must("observe_react_narrate");
    expect(orn.parts.map((part) => part.id)).toEqual(["observe", "react", "narrate"]);
    expect(nextPart(orn, "observe")?.id).toBe("react");
    expect(nextPart(orn, "react")?.id).toBe("narrate");
    expect(nextPart(orn, "narrate")).toBeNull();
  });

  it("walks a different exercise by its own parts", () => {
    const sentence = must("one_true_sentence");
    expect(sentence.parts.map((part) => part.id)).toEqual(["sentence", "onward", "stop"]);
    expect(nextPart(sentence, "sentence")?.id).toBe("onward");
    expect(nextPart(sentence, "stop")).toBeNull();
    expect(nextPart(sentence, "observe")).toBeNull();
  });

  it("shows the parts before a part above its page", () => {
    const orn = must("observe_react_narrate");
    expect(partsBefore(orn, "observe")).toEqual([]);
    expect(partsBefore(orn, "react").map((part) => part.id)).toEqual(["observe"]);
    expect(partsBefore(orn, "narrate").map((part) => part.id)).toEqual(["observe", "react"]);
    expect(partsBefore(must("noun_list"), "pull").map((part) => part.id)).toEqual(["list"]);
    expect(partsBefore(orn, "missing")).toEqual([]);
  });
});

describe("what an exercise leaves behind", () => {
  const orn = must("observe_react_narrate");
  const labels = { observe: "Noticed", react: "Felt", narrate: "Story" };
  const texts = { observe: "A grey cup.\nRain on glass.", react: "  Calm  ", narrate: "" };

  it("counts words and notices writing", () => {
    expect(exerciseWordCount("")).toBe(0);
    expect(exerciseWordCount("  one  two\nthree ")).toBe(3);
    expect(totalWords(orn, texts)).toBe(7);
    expect(hasWriting(orn, texts)).toBe(true);
    expect(hasWriting(orn, { observe: "  ", react: "\n", narrate: "" })).toBe(false);
    expect(hasWriting(orn, {})).toBe(false);
  });

  it("only counts the parts of the exercise at hand", () => {
    const pages = must("pour_it_out");
    expect(totalWords(pages, { ...texts, pages: "one two" })).toBe(2);
    expect(hasWriting(pages, texts)).toBe(false);
  });

  it("starts every part empty", () => {
    expect(emptyTexts(orn)).toEqual({ observe: "", react: "", narrate: "" });
    expect(emptyTexts(must("pour_it_out"))).toEqual({ pages: "" });
  });

  it("builds the chapter: a heading and paragraphs per part, escaped", () => {
    expect(exerciseHtml(orn, { ...texts, narrate: "a < b & c" }, labels)).toBe(
      "<h2>Noticed</h2><p>A grey cup.</p><p>Rain on glass.</p><h2>Felt</h2><p>Calm</p><h2>Story</h2><p>a &lt; b &amp; c</p>"
    );
  });

  it("keeps an empty part as a bare heading", () => {
    expect(exerciseHtml(orn, emptyTexts(orn), labels)).toBe("<h2>Noticed</h2><h2>Felt</h2><h2>Story</h2>");
  });

  it("builds the copied text with each part named", () => {
    expect(exerciseCopyText(orn, texts, labels)).toBe("Noticed\n\nA grey cup.\n\nRain on glass.\n\n\nFelt\n\nCalm\n\n\nStory");
  });

  it("leaves a one-part exercise as plain paragraphs, with no heading to repeat its title", () => {
    const pages = must("pour_it_out");
    expect(namesParts(pages)).toBe(false);
    expect(namesParts(orn)).toBe(true);
    const only = { pages: "First line.\n\nSecond <line>." };
    expect(exerciseHtml(pages, only, { pages: "Your pages" })).toBe("<p>First line.</p><p>Second &lt;line&gt;.</p>");
    expect(exerciseCopyText(pages, only, { pages: "Your pages" })).toBe("First line.\n\nSecond <line>.");
  });

  it("names the parts of every exercise that has several", () => {
    const noun = must("noun_list");
    expect(exerciseHtml(noun, { list: "the attic\na red coat", pull: "It began." }, { list: "The list", pull: "What it became" })).toBe(
      "<h2>The list</h2><p>the attic</p><p>a red coat</p><h2>What it became</h2><p>It began.</p>"
    );
  });
});
