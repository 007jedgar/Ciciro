import { runsText, type StyledBlock, type StyledRun } from "@/lib/screenplay";

/**
 * A long script built from a fixed set of scenes, for the round-trip and page
 * count tests: every element, the shapes Fountain needs a forced marker for
 * (an all-caps action line, a cue that is not capitals, a heading with no
 * INT./EXT., a transition that is not "TO:"), two lines of dialogue in one
 * speech, and bold, italic and underline. Deterministic: no randomness.
 */

const run = (text: string, marks: Omit<StyledRun, "text"> = {}): StyledRun => ({ text, ...marks });
const plain = (element: string, text: string): StyledBlock => ({ element, runs: [run(text)] });

function scene(n: number): StyledBlock[] {
  const place = ["MARA'S APARTMENT", "ROOFTOP", "SERVICE STAIRCASE", "ALL-NIGHT DINER", "HARBOR"][n % 5];
  const time = ["NIGHT", "DAY", "CONTINUOUS", "LATER"][n % 4];
  const blocks: StyledBlock[] = [
    plain("scene-heading", `${n % 2 === 0 ? "int." : "ext."} ${place.toLowerCase()} - ${time.toLowerCase()}`),
    {
      element: "action",
      runs: [
        run(`Rain streaks the glass in scene ${n}. `),
        run("MARA", { bold: true }),
        run(" (30s) waits by the "),
        run("unplugged", { italic: true }),
        run(" phone, counting the seconds the way she always does, and the well-known silence of the room presses in."),
      ],
    },
    plain("action", "BOOM."),
    plain("character", "mara"),
    plain("parenthetical", "to herself"),
    plain(
      "dialogue",
      `He is not going to call. He is not going to call, and that is fine, because I am fine. Scene ${n}, and still fine.`
    ),
    plain("character", "jonah (v.o.)"),
    {
      element: "dialogue",
      runs: [run("Mara, it's me. "), run("Please", { underline: true }), run(" listen. I have been carrying it around like a stone.")],
    },
    plain("dialogue", "And I would give anything to put it down."),
    plain("action", "The phone lights up. She does not move.\nShe does not breathe."),
  ];
  if (n % 3 === 0) blocks.push(plain("shot", "close on the screen"));
  if (n % 4 === 1) blocks.push(plain("character", "2ND OFFICER"), plain("dialogue", "Ma'am?"));
  blocks.push(plain("transition", n % 5 === 4 ? "fade out." : "cut to:"));
  return blocks;
}

/** About `pages` pages of script in `sequences` sequences. */
export function longScript(pages: number, sequences = 3): { title: string; blocks: StyledBlock[] }[] {
  const out = Array.from({ length: sequences }, (_, i) => ({ title: `Sequence ${i + 1}`, blocks: [] as StyledBlock[] }));
  // A scene runs about a page and a third; fill until the count is met.
  const scenes = Math.ceil(pages * 1.75);
  for (let n = 0; n < scenes; n++) out[Math.min(sequences - 1, Math.floor((n * sequences) / scenes))].blocks.push(...scene(n));
  return out;
}

export const plainText = (blocks: readonly StyledBlock[]) => blocks.map((b) => runsText(b.runs));
