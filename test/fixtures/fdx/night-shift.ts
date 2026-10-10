import type { FountainScript } from "@/lib/fountain";
import type { StyledBlock, StyledRun } from "@/lib/screenplay";

/**
 * A short script that uses everything FDX carries: numbered scenes, bold,
 * italic and underline, a line break inside action, a cue with an extension, a
 * parenthetical, two lines of dialogue in one speech, a dual-dialogue pair, a
 * shot, a transition, centered text, a title page, and two sequences (which FDX
 * writes one after the other). Nothing in it needs a forced marker, so the
 * oracle readers (test/fdx.test.ts) all see the same script.
 *
 * `night-shift.fdx` is what `fdxFromScript` writes for it with scene numbers on;
 * `afterwriting.fountain` is what afterwriting's FDX converter makes of that
 * file. Regenerate the first with `UPDATE_GOLDEN=1`; the second is checked in as
 * produced (see the note at the end of that file).
 */
const run = (text: string, marks: Omit<StyledRun, "text"> = {}): StyledRun => ({ text, ...marks });
const plain = (element: string, text: string, extra: Partial<StyledBlock> = {}): StyledBlock => ({
  element,
  runs: [run(text)],
  ...extra,
});

export const NIGHT_SHIFT_FDX: FountainScript = {
  title: "Night Shift",
  author: "Jo Writer",
  titlePage: {
    title: "Night Shift",
    credit: "Written by",
    author: "Jo Writer",
    source: "Based on a true story",
    draftDate: "Oct 2026",
    contact: "Jo Writer\n12 Main St\njo@example.com",
  },
  sequences: [
    {
      title: "Sequence 1",
      blocks: [
        plain("scene-heading", "int. mara's apartment - night"),
        {
          element: "action",
          runs: [
            run("Rain streaks the window. "),
            run("MARA", { bold: true }),
            run(" (30s) stares at an "),
            run("unplugged", { italic: true }),
            run(" phone, and the "),
            run("well-known", { underline: true }),
            run(" silence of the room, "),
            run("all of it", { bold: true, italic: true }),
            run(", presses in.\nShe does not move."),
          ],
        },
        plain("character", "mara"),
        plain("parenthetical", "to herself"),
        plain("dialogue", "He is not going to call. He is not going to call, and that is fine."),
        plain("character", "jonah (v.o.)"),
        plain("dialogue", "Mara, it's me. I know it's late & I know you said not to."),
        plain("dialogue", "Pick up."),
        plain("character", "brick"),
        plain("dialogue", "Screw retirement."),
        plain("character", "steel", { dual: true }),
        plain("parenthetical", "grinning"),
        plain("dialogue", "Screw retirement, too."),
        plain("shot", "close on the phone"),
        plain("transition", "cut to:"),
      ],
    },
    {
      title: "Sequence 2",
      blocks: [
        plain("scene-heading", "ext. rooftop - continuous"),
        plain("action", "Wind. A water tower groans."),
        plain("centered", "THE END"),
      ],
    },
  ],
};
