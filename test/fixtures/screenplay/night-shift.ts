import type { ScriptBlock } from "@/lib/screenplay";

/**
 * A short script that exercises every element, a speech that wraps, and enough
 * pages to hit each page-break rule. test/screenplay.test.ts sets it on the page
 * and compares with night-shift.pages.txt, so a change to the layout shows up
 * as a diff of the pages themselves. Regenerate with `UPDATE_GOLDEN=1`.
 */
export const NIGHT_SHIFT: ScriptBlock[] = [
  { element: "scene-heading", text: "int. mara's apartment - night" },
  {
    element: "action",
    text: "Rain streaks the window. MARA (30s, exhausted) stares at an unplugged phone. She has been staring at it for what feels like hours, and the well-known silence of the room presses in.",
  },
  { element: "character", text: "mara" },
  { element: "parenthetical", text: "to herself" },
  { element: "dialogue", text: "He is not going to call. He is not going to call, and that is fine, because I am fine." },
  { element: "action", text: "The phone lights up. She does not move." },
  { element: "character", text: "jonah (v.o.)" },
  {
    element: "dialogue",
    text: "Mara, it's me. I know it's late. I know you said not to, and I tried not to, I really did, but there is something I should have told you in the spring and I have been carrying it around ever since like a stone in my coat.",
  },
  { element: "character", text: "mara" },
  { element: "dialogue", text: "Don't." },
  { element: "transition", text: "cut to:" },
  { element: "scene-heading", text: "ext. rooftop - continuous" },
  { element: "shot", text: "wide on the city" },
  {
    element: "action",
    text: "Wind. A water tower groans. JONAH (40s, coat collar up) paces the length of the roof with the phone pressed to his ear, listening to it ring out. He tries again. And again. On the fourth try the line connects, and he stops dead, one foot on the low parapet.",
  },
  { element: "character", text: "jonah" },
  { element: "dialogue", text: "You picked up." },
  { element: "character", text: "mara (o.s.)" },
  { element: "dialogue", text: "I did not. The phone is face down on the table. I can hear you through the floor." },
  {
    element: "action",
    text: "Jonah looks down. Directly beneath his boots, the skylight glows yellow. Behind it, a woman sits very still.",
  },
  { element: "scene-heading", text: "int. mara's apartment - continuous" },
  {
    element: "action",
    text: "Mara looks up at the skylight. Jonah's shadow falls across the table, over the phone, over her hands. Neither of them says anything for a long time. The rain gets louder, then softer, then stops as if somebody had closed a door on it.",
  },
  { element: "character", text: "mara" },
  { element: "parenthetical", text: "finally" },
  {
    element: "dialogue",
    text: "You can come down. The door is open. It has been open since March, and I would like you to understand that I am not saying that to be kind, I am saying it because I am tired of locking it every night and then lying awake listening for the sound of you not turning the handle.",
  },
  { element: "character", text: "jonah" },
  { element: "dialogue", text: "I'm not sure I can." },
  { element: "character", text: "mara" },
  { element: "dialogue", text: "Then stay up there and freeze, I suppose." },
  { element: "transition", text: "smash cut to:" },
  { element: "scene-heading", text: "ext. rooftop - later" },
  { element: "action", text: "The roof is empty. A single boot print in the wet tar, pointing at the stairwell door." },
  { element: "transition", text: "fade out." },
];
