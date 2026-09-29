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
  headlineLead: "Most novels don't stall from writer's block. They stall from",
  headlineKey: "silence.",
  sideNoteTitle: "Unfinished. Not abandoned.",
  sideNote: "Reminders on the days you pick. Five minutes counts. Rest days are built in.",
  sub:
    "On the days you pick, Ciciro's phone app reminds you with the last lines you wrote and one nudge back into the scene. Open the manuscript and your cursor is exactly where you stopped, at your desk or on your phone. Five minutes is enough to keep going.",
  chips: ["Reminders on your days", "Back at your last sentence", "No streak to break", "Your prose, your call"],
};

export type ValueProp = { tab: string; numeral: string; title: string; body: string };

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
    },
    {
      tab: "02 / Coming back",
      numeral: "ii.",
      title: "“Every time I come back, I have to reread everything.”",
      body:
        "Twelve hours or more away, and Ciciro greets you with a short “previously on” of your recent chapters, and your cursor is waiting where you left it, desk or phone. The reminder itself shows the last sentence you wrote.",
    },
    {
      tab: "03 / Guilt",
      numeral: "iii.",
      title: "“I missed a day, so why bother.”",
      body:
        "There is no streak here. Choose how many days a week you're aiming for, and Ciciro shows how many of the last seven you wrote. Rest days are part of the plan, and nothing resets to zero.",
    },
    {
      tab: "04 / The book",
      numeral: "iv.",
      title: "“Wait, what color were her eyes?”",
      body:
        "Characters, places, timeline and canon live in a story bible beside the chapters. On the web, a continuity check reads a chapter or the whole book against it and flags contradictions without touching a word.",
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
};

export const CLOSING = {
  kicker: "Early access",
  headingLead: "Start the habit",
  headingKey: "tonight.",
  sub: "Early access is open, and your manuscripts, story bible and exports are free. Bring the sentence you already started.",
};

/** The reminder the phone in the hero shows: a real reminder's shape. */
export const SCENE = {
  reminderTitle: "Time to write The Letter",
  reminderBody: "She didn't need to unfold it, only to feel the weight of it.",
  reminderNudge: "Mara still hasn't said who sent it.",
};
