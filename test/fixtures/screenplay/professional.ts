import type { ScriptBlock } from "@/lib/screenplay";

/**
 * A script for the professional layout: numbered scenes, a dual-dialogue pair
 * (one speech with a parenthetical), centered text, and a long speech that runs
 * past two page breaks, so the pages carry (MORE), the repeated cue with
 * (CONT'D), and a page that opens on a dual pair. test/screenplay.test.ts sets
 * it on the page and compares with professional.pages.txt. Regenerate with
 * `UPDATE_GOLDEN=1`.
 */
const speech = (n: number) =>
  Array.from({ length: n }, (_, i) => `Sentence ${i + 1} of a long speech, which goes on because she has a lot to say.`).join(" ");

export const PROFESSIONAL: ScriptBlock[] = [
  { element: "scene-heading", text: "int. bar - night" },
  { element: "action", text: "A small crowd. MARA (30s) and JONAH (40s) at opposite ends of the counter." },
  { element: "character", text: "mara" },
  { element: "dialogue", text: "You said you would not come." },
  { element: "character", text: "jonah (v.o.)", dual: true },
  { element: "parenthetical", text: "over the music" },
  { element: "dialogue", text: "I said a lot of things, and none of them were true, and you know it as well as I do." },
  { element: "centered", text: "- A LONG MINUTE -" },
  { element: "scene-heading", text: "ext. street - continuous" },
  ...Array.from({ length: 8 }, (_, i): ScriptBlock => ({
    element: "action",
    text: `Rain on the awning, number ${i + 1}, and a neon sign that flickers on the wet street below.`,
  })),
  { element: "character", text: "mara" },
  { element: "dialogue", text: speech(9) },
  { element: "action", text: "She lights a cigarette. It takes three tries." },
  { element: "character", text: "mara" },
  { element: "dialogue", text: speech(26) },
  { element: "character", text: "jonah" },
  { element: "dialogue", text: "Done?" },
  { element: "character", text: "mara" },
  { element: "dialogue", text: "No." },
  { element: "character", text: "jonah", dual: true },
  { element: "dialogue", text: "I know." },
  { element: "transition", text: "cut to black." },
];
