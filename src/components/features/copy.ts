import type { Metadata } from "next";
import type { Exhibit } from "@/components/landing/copy";

// Every line on the Features page. Same voice as the landing page's copy.ts:
// outcome-first headlines, concrete nouns, second person, no em dashes. The
// body of each item names the specific capability plainly, including the AI
// ones, without hype. Keep every claim to what ships today.

export const FEATURES_METADATA: Metadata = {
  title: "Ciciro Features - continuity, voice, and habit for writers",
  description:
    "See everything Ciciro does: a story bible that tracks who knows what, AI edits you accept or reject, screenplay support (Beta), and reminders that bring you back to the last line you wrote.",
};

export const FEATURES_HERO = {
  eyebrow: "Everything in Ciciro",
  headingLead: "Everything in Ciciro,",
  headingKey: "writer by writer.",
  sub:
    "Novel, screenplay, journal or blog: the same editor, story bible and habit-keeping reminders, with the parts that matter shaped to what you're writing.",
  chips: ["Novels", "Screenplays (Beta)", "Journals", "Blogs"],
};

/** One capability inside a section's card grid: a headline, one or two
    sentences of plain description, and an optional beta/platform caveat
    shown as a small pill under the body. */
export type FeatureItem = {
  headline: string;
  body: string;
  /** A short caveat badge, e.g. "Beta", "Web only", "iOS only". Omit for a
      feature that ships everywhere with no qualifier. */
  badge?: string;
};

export type FeatureSection = {
  id: string;
  kicker: string;
  headingLead: string;
  headingKey: string;
  intro?: string;
  items: FeatureItem[];
  /** A real screenshot or clip from the app, reusing the landing page's
      Exhibit component. Omit to ship the section text-led. */
  exhibit?: Exhibit;
};

export const FEATURES_SECTIONS: FeatureSection[] = [
  {
    id: "consistency",
    kicker: "Keep the book consistent",
    headingLead: "Nobody learns a secret",
    headingKey: "before they should.",
    intro:
      "Characters, places, timeline and canon live in a story bible beside the chapters, and Ciciro reads it before it reads your prose.",
    items: [
      {
        headline: "Story bible",
        body:
          "Characters, places, timeline and canon live in files beside the chapters, one glance away while you write.",
      },
      {
        headline: "Who-knows-what ledger",
        body:
          "Every character's knowledge is tracked chapter by chapter: what they know, suspect, or wrongly believe, and when that changes. Ciciro's edits and its continuity check only ever see what a character knew by that point in the story.",
      },
      {
        headline: "Continuity check",
        body:
          "Run a check on one chapter or the whole book, and Ciciro flags contradictions against your story bible without touching a word.",
      },
      {
        headline: "What changed",
        body:
          "After you finish a chapter, Ciciro proposes the facts it should remember: a new rule for the world, a loop to close, something a character now knows. Keep the ones you want; nothing is written until you say so.",
      },
    ],
    exhibit: {
      label: "Exhibit / Web app",
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
  {
    id: "edits",
    kicker: "AI that edits, not ghost-writes",
    headingLead: "AI edits you",
    headingKey: "accept or reject.",
    intro:
      "When Ciciro changes your lines, the changes arrive as suggestions, never a silent rewrite, and you decide how much control to hand over in any given conversation.",
    items: [
      {
        headline: "Suggestions and tracked changes",
        body:
          "Ciciro's edits show up as suggestions in the text. Accept or reject each one, or all at once, and every chapter keeps a history you can restore.",
      },
      {
        headline: "Allow edits / Chat only, and a real Stop",
        body:
          "Switch any conversation to Chat only and Ciciro will discuss your book but never touch it, enforced on the server, not just the screen. Stop actually stops the run.",
      },
      {
        headline: "AI-involvement tally",
        body:
          "A running tally shows how much of the book came from Ciciro and how much you wrote yourself, per chapter and for the whole manuscript. It's a record for you, not a guarantee of compliance with any platform's disclosure rules.",
      },
      {
        headline: "Craft defaults",
        body:
          "Turn on the Experimental writing prompt (off by default) and Ciciro's drafts steer away from the tells of AI-written fiction: weather that mirrors mood, tidy epiphanies, \"not X but Y.\" Your own style guide always wins.",
      },
    ],
    exhibit: {
      label: "Exhibit / Web app",
      caption:
        "Asked to tighten a paragraph, Ciciro marks three changes in the text. The writer takes them or leaves them, one at a time.",
      media: {
        kind: "still",
        day: "/landing/workspace-day.webp",
        night: "/landing/workspace-night.webp",
        width: 1600,
        height: 1000,
        narrow: {
          day: "/landing/workspace-narrow-day.webp",
          night: "/landing/workspace-narrow-night.webp",
          width: 820,
          height: 590,
        },
        alt: "The web editor on chapter five of The Letter, with three suggestions from Ciciro marked in the third paragraph, Accept all and Reject all above, and the chat where the writer asked for the paragraph to be tightened.",
        frame: "window",
      },
    },
  },
  {
    id: "voice",
    kicker: "Find your voice",
    headingLead: "Tell Ciciro your voice",
    headingKey: "by writing, not describing it.",
    intro:
      "No style instructions to write by hand: Ciciro reads your own prose for the patterns, and a set of one-tap tools work on exactly the passage you've highlighted.",
    items: [
      {
        headline: "Analyze my style",
        body:
          "One click reads a spread of your own chapters and drafts a style guide and a character voice sheet, each claim backed by a quote from your prose. Nothing saves until you approve it.",
      },
      {
        headline: "Quick actions",
        body:
          "Ten scoped one-tap prompts, aware of what you're writing: a novel, screenplay, blog post or journal entry each get a different set.",
      },
      {
        headline: "The menu over highlighted text",
        body:
          "Select a word or a passage for Comment, Rewrite, Describe, Expand or Fix, plus synonym suggestions that match the case of the word you picked.",
      },
      {
        headline: "Repetition check",
        body: "Flags overused words and phrases across the manuscript. No AI, no API key needed.",
        badge: "Web only",
      },
    ],
  },
  {
    id: "write-anything",
    kicker: "Write anything",
    headingLead: "Write anything,",
    headingKey: "including a script.",
    intro:
      "Switch a manuscript's kind between novel, screenplay, blog and journal, and the editor, quick actions and bible all follow. Screenplay is the newest of them, and it's still Beta.",
    items: [
      {
        headline: "A real screenplay, paginated as you write it",
        body:
          "Scene headings, cues and dialogue, typed fast with name/place/time autocomplete and typed capitals. Exact pagination, a title page, dual dialogue and a scene navigator, the way a working screenwriter expects.",
        badge: "Beta",
      },
      {
        headline: "Screenplay import and export",
        body:
          "Bring a script in or send it out as Fountain, or export FDX for use in other screenwriting software. Ciciro makes no claim that Final Draft opens the FDX unchanged.",
        badge: "Beta",
      },
      {
        headline: "Live page layout on the phone",
        body:
          "On iPhone, the screenplay editor paginates live as you type, the same page count the exported PDF will show.",
        badge: "iOS only, Beta",
      },
      {
        headline: "Two languages for now",
        body:
          "Screenplay formatting covers English and Spanish today, with more languages planned. A control that can't work in another language yet is shown, not hidden, with an explanation.",
        badge: "English and Spanish only",
      },
    ],
  },
  {
    id: "plan",
    kicker: "Plan before you draft",
    headingLead: "Plan before",
    headingKey: "there's a chapter to outline.",
    intro:
      "A chapter-by-chapter outline for when you know the shape of the book, a blank board for when you don't, and a weekly look back either way.",
    items: [
      {
        headline: "Outline",
        body: "A chapter-by-chapter outline beside the manuscript, reordered by dragging, on the web and the phone.",
      },
      {
        headline: "Canvas",
        body:
          "A blank board for cards and arrows. Ask Ciciro to fill a card, offer options, or sketch a full outline from one premise. Nothing here becomes a chapter until you write it.",
        badge: "Web only",
      },
      {
        headline: "Scratchpad",
        body: "Up to 200 research notes, synced across every device, with conflicts handled automatically.",
      },
      {
        headline: "Weekly review",
        body:
          "A look back at the last seven days: what moved, what's still open, and a few concrete next steps, saved so you can reread any past week.",
      },
    ],
    exhibit: {
      label: "Exhibit / Web app",
      caption: 'The Outline panel listing Mara\'s chapters, ending on Chapter 12, "The Letter".',
      media: {
        kind: "still",
        day: "/landing/scene-outline-day.webp",
        night: "/landing/scene-outline-night.webp",
        width: 632,
        height: 555,
        alt: 'The Outline panel listing Mara\'s chapters, ending on Chapter 12, "The Letter".',
        frame: "window",
      },
    },
  },
  {
    id: "finish",
    kicker: "Finish, on your terms",
    headingLead: "A deadline that tells you",
    headingKey: "the truth, not a streak.",
    intro:
      "Coming back to a manuscript is the hardest part. Ciciro picks up where you stopped and tells you plainly how the schedule looks.",
    items: [
      {
        headline: "Manuscript deadlines",
        body:
          "Set a due date and a word count. Ciciro reads your real pace over the last two weeks and tells you plainly if you're ahead, on track, or should pick it up.",
        badge: "Phone app",
      },
      {
        headline: "\"Previously on\"",
        body:
          "Twelve hours or more away, and Ciciro greets you with a short recap of your recent chapters before you write the next line.",
      },
      {
        headline: "\"I'm stuck\"",
        body: "Concrete next-step suggestions drawn from the chapter, your story bible and your open questions.",
      },
      {
        headline: "Version history",
        body: "Automatic snapshots of every chapter, with an Undo-safe restore if a rewrite goes the wrong way.",
      },
    ],
  },
  {
    id: "share",
    kicker: "Share and get feedback",
    headingLead: "Share a chapter,",
    headingKey: "no account required.",
    intro: "Beta readers comment on your chapters without ever signing up for anything.",
    items: [
      {
        headline: "Beta reader links",
        body: "Share a chapter by link. A beta reader comments by name, with no account needed.",
      },
      {
        headline: "Resolve and reopen",
        body:
          "Mark a comment resolved once you've addressed it, reopen it if it needs another pass, and jump straight to where it points in the text after an edit.",
      },
    ],
  },
  {
    id: "read-write",
    kicker: "Read it, say it, keep it",
    headingLead: "Hear it.",
    headingKey: "Say it.",
    intro: "Ways to meet the page that aren't typing, and a record you can take with you.",
    items: [
      {
        headline: "Read aloud",
        body: "Listen to any chapter sentence by sentence, at your speed, to catch the lines that don't sound right out loud.",
      },
      {
        headline: "Dictation",
        body: "Skip the keyboard and dictate straight into the page, with spoken punctuation commands.",
        badge: "Browser and platform limits apply",
      },
      {
        headline: "Focus and typewriter modes",
        body: "Dim everything but the current paragraph, or keep the line you're writing centered on the screen.",
      },
      {
        headline: "Import and export",
        body:
          "Bring your draft in from Word, Markdown or Scrivener, and send it out as Word, EPUB or PDF. Your data export and account deletion are both self-serve, from Settings.",
      },
    ],
  },
];

export const FEATURES_CLOSING = {
  kicker: "Early access",
  headingLead: "Start the habit",
  headingKey: "tonight.",
  sub: "Early access is open, and your manuscripts, story bible and exports are free. Bring the sentence you already started.",
};
