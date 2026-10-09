import type { Metadata } from "next";

// Every line on the landing page. Each value prop names a pain writers report
// when finishing a book (time and procrastination far more than "block",
// short windows, the cost of coming back, all-or-nothing guilt, losing track
// of the book, fear of AI writing it for them) and answers it with something
// Ciciro does today. Reminders are the phone app's; keep every claim to what
// ships, and never use em dashes.

export const LANDING_METADATA: Metadata = {
  title: "Ciciro - a reason to open the file again tomorrow",
  description:
    "Ciciro reminds you on the days you choose, shows you the last lines you wrote, and puts your cursor back where you stopped, at your desk or on your phone. Five minutes is enough to keep a novel alive.",
};

export const HERO = {
  eyebrow: "For writers who keep meaning to get back to it",
  headlineStart: "Most",
  /** The subject the headline retypes, first word first. Plural, and only the
      forms Ciciro is built for (see src/lib/manuscript-kind.ts). */
  headlineSubjects: ["novels", "journals", "screenplays", "blogs", "memoirs", "newsletters", "scripts"],
  headlineLead: "don't stall from writer's block. They stall from",
  headlineKey: "silence.",
  sideNoteTitle: "Unfinished. Not abandoned.",
  sideNote: "Reminders on the days you pick. Five minutes counts. Rest days are built in.",
  sub:
    "On the days you pick, Ciciro's phone app reminds you with the last lines you wrote and one nudge back into the scene. Open the manuscript and your cursor is exactly where you stopped, at your desk or on your phone. Five minutes is enough to keep going.",
  chips: ["Reminders on your days", "Back at your last sentence", "No streak to break", "Your prose, your call"],
};

/** A screenshot of the real app, in a day and a night version. */
export type Still = {
  kind: "still";
  day: string;
  night: string;
  width: number;
  height: number;
  alt: string;
  /** "cutout": a piece of the phone app; "window": the web app in a browser. */
  frame: "cutout" | "window";
  /** A closer crop for phone-width screens, where the whole window is too small to read. */
  narrow?: { day: string; night: string; width: number; height: number };
};

/** A short screen recording from the phone app, with the frame it rests on. */
export type Clip = {
  /** WebM (VP9) first for browsers without H.264, then MP4. */
  day: { webm: string; mp4: string; poster: string };
  night: { webm: string; mp4: string; poster: string };
  width: number;
  height: number;
  alt: string;
};

export type Exhibit = {
  label: string;
  caption: string;
  media: Still | { kind: "phones"; clips: Clip[] };
};

export type ValueProp = { tab: string; numeral: string; title: string; body: string; exhibit: Exhibit };

export const HOW = {
  kicker: "What gets in the way",
  headingLead: "What gets in the way, and what Ciciro",
  headingKey: "does about it",
  items: [
    {
      tab: "01 / Time",
      numeral: "i.",
      title: "“I only ever have twenty minutes.”",
      body:
        "Most novels get written around a day job, in short stolen sessions. Any words count as a writing day, and the phone app works offline, so a line on the train is saved and counted. Pick the days and time you want a reminder.",
      exhibit: {
        label: "Exhibit A / Phone app",
        caption: "Which days, what time, how many words: a reminder for The Letter, four days a week.",
        media: {
          kind: "still",
          day: "/landing/reminder-day.webp",
          night: "/landing/reminder-night.webp",
          width: 600,
          height: 657,
          alt: "The phone app's reminder form for The Letter: a 250-word goal at 8:00 AM on Monday, Wednesday, Thursday and Saturday.",
          frame: "cutout",
        },
      },
    },
    {
      tab: "02 / Coming back",
      numeral: "ii.",
      title: "“Every time I come back, I have to reread everything.”",
      body:
        "Twelve hours or more away, and Ciciro greets you with a short “previously on” of your recent chapters, and your cursor is waiting where you left it, desk or phone. The reminder itself shows the last sentence you wrote.",
      exhibit: {
        label: "Exhibit B / Phone app",
        caption: "The reminder quotes the last lines and opens the book. Two more sentences, right where the desk left off.",
        media: {
          kind: "phones",
          clips: [
            {
              day: { webm: "/landing/phone-reminder-day.webm", mp4: "/landing/phone-reminder-day.mp4", poster: "/landing/phone-reminder.webp" },
              night: { webm: "/landing/phone-reminder-night.webm", mp4: "/landing/phone-reminder-night.mp4", poster: "/landing/phone-reminder.webp" },
              width: 600,
              height: 1304,
              alt: "A reminder arrives on the phone: “Time to write The Letter”, quoting the last lines written. Tapping it opens the manuscript.",
            },
            {
              day: { webm: "/landing/phone-type-day.webm", mp4: "/landing/phone-type-day.mp4", poster: "/landing/phone-type-day.webp" },
              night: { webm: "/landing/phone-type-night.webm", mp4: "/landing/phone-type-night.mp4", poster: "/landing/phone-type-night.webp" },
              width: 600,
              height: 1304,
              alt: "The phone editor open at the end of chapter five, where the writer adds: “She unfolded the letter. The first line was her brother's name.”",
            },
          ],
        },
      },
    },
    {
      tab: "03 / Guilt",
      numeral: "iii.",
      title: "“I miss a day, then two...”",
      body:
        "There is no streak here. Choose how many days a week you're aiming for, and Ciciro shows how many of the last seven you wrote. Rest days are part of the plan, and nothing resets to zero.",
      exhibit: {
        label: "Exhibit C / Phone app, Settings",
        caption: "A number of days to aim for, not a chain to keep unbroken.",
        media: {
          kind: "still",
          day: "/landing/daily-day.webp",
          night: "/landing/daily-night.webp",
          width: 600,
          height: 320,
          alt: "The Daily words setting: five minutes is a session; aim for 4 of the last 7 days, and the rest are rest days, not a streak to protect. Word goal 250 words, 4 days per week.",
          frame: "cutout",
        },
      },
    },
    {
      tab: "04 / The book",
      numeral: "iv.",
      title: "“Wait, what color were her eyes?”",
      body:
        "Characters, places, timeline and canon live in a story bible beside the chapters. On the web, a continuity check reads a chapter or the whole book against it and flags contradictions without touching a word.",
      exhibit: {
        label: "Exhibit D / Web app",
        caption: "Ines's eyes are grey in the story bible, one glance away from the chapter.",
        media: {
          kind: "still",
          day: "/landing/bible-day.webp",
          night: "/landing/bible-night.webp",
          width: 1100,
          height: 800,
          alt: "The web app's story bible open beside chapter five of The Letter, showing Ines Lind's entry: seventy-one, Mara's aunt, grey eyes.",
          frame: "window",
        },
      },
    },
  ] as ValueProp[],
};

export const WHY = {
  kicker: "Why Ciciro",
  headingLead: "Help that leaves the",
  headingKey: "writing to you",
  body:
    "Most writing tools assume you'll show up with an hour and momentum, and most AI tools assume you want the book written for you. Ciciro assumes neither. When it edits your lines, the changes arrive as suggestions you accept or reject. Every chapter keeps a history you can restore, and a running tally shows how much of the book came from Ciciro and how much you wrote yourself.",
  receiptTitle: "What you keep",
  receipt: [
    "Chapters, story bible and scratch notes in one place, not six tabs",
    "Your draft in from Word, Markdown or Scrivener, and out as Word, EPUB or PDF",
    "Chapters shared with beta readers by link, no account needed to comment",
  ],
  receiptTotal: ["Your exports", "Free"] as [string, string],
  exhibit: {
    label: "Exhibit E / Web app",
    caption:
      "Asked to tighten a paragraph, Ciciro marks three changes in the text. The writer takes them or leaves them, one at a time.",
    media: {
      kind: "still",
      day: "/landing/workspace-day.webp",
      night: "/landing/workspace-night.webp",
      width: 1600,
      height: 1000,
      narrow: { day: "/landing/workspace-narrow-day.webp", night: "/landing/workspace-narrow-night.webp", width: 820, height: 590 },
      alt: "The web editor on chapter five of The Letter, with three suggestions from Ciciro marked in the third paragraph, Accept all and Reject all above, and the chat where the writer asked for the paragraph to be tightened.",
      frame: "window",
    },
  } as Exhibit,
};

export const CLOSING = {
  kicker: "Early access",
  headingLead: "Start the habit",
  headingKey: "tonight.",
  sub: "Early access is open, and your manuscripts, story bible and exports are free. Bring the sentence you already started.",
};

/** The iOS TestFlight beta signup. Stores an email only; the invite is sent by hand. */
export const BETA = {
  kicker: "iPhone app beta",
  headingLead: "Try the phone app",
  headingKey: "before everyone else.",
  body: "Leave your email and we'll send you an invite to the Ciciro iOS beta on TestFlight. It is only for the iPhone TestFlight beta, nothing else.",
  label: "Email address",
  placeholder: "you@example.com",
  submit: "Join the iOS beta",
  submitting: "Joining...",
  success: "You're on the list. We'll email your TestFlight invite.",
  invalid: "Enter a valid email address.",
  failure: "Could not sign you up. Try again.",
};

export const PRICING = {
  kicker: "Pricing",
  headingLead: "Free to write in.",
  headingKey: "Pro when you want more.",
  body:
    "Your manuscripts, story bible, reminders, exports and sync cost nothing, now or later. Ciciro Pro adds more of the AI editor each month, for less than most writing tools with AI built in.",
  free: (runs: number | null) =>
    runs === null
      ? "The whole editor, the phone app, and the AI editor."
      : `The whole editor, the phone app, and ${runs} AI actions a month.`,
  pro: "A far bigger AI allowance, one subscription for the web and the apps. Cancel any time.",
  offer: "Writing with us in early access? Your first Pro subscription comes with a founding discount.",
};

/** The reminder the phone in the hero shows: a real reminder's shape. */
export const SCENE = {
  reminderTitle: "Time to write The Letter",
  reminderBody: "She didn't need to unfold it, only to feel the weight of it.",
  reminderNudge: "Mara still hasn't said who sent it.",
};

/** A screenshot pair (day/night) of a real Ciciro screen, cropped to sit on
    the landing folder's paper sheet. */
export type SceneShot = { day: string; night: string; width: number; height: number; alt: string };

/** The three binder tabs beside the folder. Clicking one swaps the sheet, and
    the phone beside it, for real Ciciro screens in the world of The Letter,
    so the tabs read as one manuscript. See Scene.tsx. */
export const SCENE_TABS: Record<
  "chapters" | "characters" | "outline",
  { label: string; tag: string; title: string; footNote: string; sheet: SceneShot; phone?: SceneShot }
> = {
  chapters: {
    label: "Chapter 12",
    tag: "CH. 12",
    title: "The Letter",
    footNote: "p. 214",
    sheet: {
      day: "/landing/scene-chapters-day.webp",
      night: "/landing/scene-chapters-night.webp",
      width: 545,
      height: 480,
      alt: 'The chapter editor open on Chapter 12, "The Letter": the harbour had gone quiet, and Mara took the letter from her coat pocket.',
    },
  },
  characters: {
    label: "Characters",
    tag: "3 FILES",
    title: "Story Bible",
    footNote: "3 files",
    sheet: {
      day: "/landing/scene-characters-day.webp",
      night: "/landing/scene-characters-night.webp",
      width: 438,
      height: 430,
      alt: "The Story Bible drawer listing canon.md and the character files for Mara, Ines Lind and the Dockmaster.",
    },
    phone: {
      day: "/landing/scene-characters-phone-day.webp",
      night: "/landing/scene-characters-phone-night.webp",
      width: 520,
      height: 959,
      alt: "The mobile Story Bible screen listing the same character files for Mara, Ines Lind and the Dockmaster.",
    },
  },
  outline: {
    label: "Outline",
    tag: "CH. 8-12",
    title: "Outline",
    footNote: "12 chapters",
    sheet: {
      day: "/landing/scene-outline-day.webp",
      night: "/landing/scene-outline-night.webp",
      width: 632,
      height: 555,
      alt: 'The Outline panel listing Mara\'s chapters, ending on Chapter 12, "The Letter".',
    },
    phone: {
      day: "/landing/scene-outline-phone-day.webp",
      night: "/landing/scene-outline-phone-night.webp",
      width: 520,
      height: 959,
      alt: "The mobile Outline screen listing the same chapters of Mara's story.",
    },
  },
};
