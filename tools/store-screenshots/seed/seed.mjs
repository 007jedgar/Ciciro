#!/usr/bin/env node
// Seeds a LOCAL Ciciro server with the sample manuscripts the captures show:
// "Belt Buckle First", a satirical novel about an alien invasion that lifts
// everyone in Dayton into the sky except the narrator, and a short script from
// the same world, "Number Forty-Seven". Never point it at production (it
// refuses a non-local base URL).
//
//   node seed/seed.mjs [--base http://localhost:3187] [--db ../../prisma/dev.db] [--reset]
//
// --reset deletes the demo account's existing manuscripts first.
//
// It signs up the demo account (or signs in if it exists), then writes through
// the same HTTP API the apps use, so every row is one the server would make
// itself. The weekly review is the one direct database write: the real one
// needs a model call, and a capture must not spend one.

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith("--") ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), [])
);
const BASE = (args.base ?? "http://localhost:3187").replace(/\/$/, "");
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`Refusing to seed ${BASE}: this only seeds a local server.`);
  process.exit(1);
}

export const DEMO = { email: "store-shots@ciciro.test", password: "Letter-2026-demo", name: "Dana Whitlock" };

let cookie = "";
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${typeof json === "string" ? json : JSON.stringify(json)}`);
  return json;
}

const p = (id, html) => `<p data-block-id="b${id}">${html}</p>`;
const html = (paragraphs) => paragraphs.map((t, i) => p(i + 1, t)).join("");

const SUGGEST = (id, from, to) =>
  [
    `<del data-suggestion-id="sg-${id}" data-author-id="ciciro" data-author-name="Ciciro" data-created-at="${new Date().toISOString()}">${from}</del>`,
    `<ins data-suggestion-id="sg-${id}" data-author-id="ciciro" data-author-name="Ciciro" data-created-at="${new Date().toISOString()}">${to}</ins>`,
  ].join("");

// Nine short chapters. Chapter 1 is the hero shot, chapter 4 carries Ciciro's
// pending suggestions (a limp metaphor swapped for one you can see), chapter 7
// is where the reminder picks up. The rest read as a book in lists and recaps.
const CHAPTERS = [
  [
    "Tuesday",
    [
      "The aliens arrived on a Tuesday, which Dale Pruitt took personally. It was bowling night.",
      "By Wednesday all of Dayton was rising, calmly, belt buckle first. Nobody lifted Dale. He checked his pockets, in case he'd been issued something.",
    ],
  ],
  [
    "The Belt Line",
    [
      "It took Dale until noon to work out the rule. The sky took you by the belt line, as if it had a hook there, and the bigger the buckle the faster the climb.",
      "Gary from Accounts, who wore a rodeo buckle the size of a hubcap, left the building like a cork leaving a bottle.",
    ],
  ],
  [
    "Rhonda",
    [
      "His ex-wife went up past the bank sign at 2:14, still holding her iced coffee. She had always said she wanted a bigger life.",
      "Dale waved. She did not wave back, being busy, but she did look down, and he decided to take that as something.",
    ],
  ],
  [
    "Aisle Nine",
    [
      "The grocery on Dorothy Lane was the only place in Dayton with the lights still on, so Dale shopped like a man with a future. Cereal. Batteries. A candle shaped like a lighthouse.",
      `By aisle nine the music had stopped, and his loneliness was ${SUGGEST("4a", "an overwhelming wave of emotion", "the last suitcase on the carousel, going round and round for nobody")}.`,
      `The self-checkout asked if he had brought his own bags. He had brought only questions. He ${SUGGEST("4b", "walked slowly out across", "crossed")} the lot feeling ${SUGGEST("4c", "very tired and extremely upset about all of it", "wrung out")}.`,
    ],
  ],
  [
    "The Tuesday League",
    [
      "The bowling league went up in order of average score, which Dale felt was a little pointed.",
      "Lorraine, a 212, led the procession. Dale, a 143, watched from the parking lot of the Strike Zone and tried not to read anything into it. He read everything into it.",
    ],
  ],
  [
    "What the Signs Said",
    [
      "On Thursday the water tower changed. PLEASE REMAIN CALM, it said. YOU ARE BEING LIFTED.",
      "Underneath, in smaller letters: SOME OF YOU WILL BE LIFTED LATER. THIS IS NORMAL. Dale read it eleven times, looking for his name in the gaps.",
    ],
  ],
  [
    "A Fair Question",
    [
      "He went up to the water tower and asked, as a citizen, whether there had been a mistake.",
      "He asked the sky politely, then not politely. The sky, which had a lot on, did not answer.",
    ],
  ],
  [
    "Suspenders",
    [
      "Gary's wife noticed first, from about four feet up. \u201cDale,\u201d she called, \u201cwhat are you wearing?\u201d",
      "He looked down. Red suspenders, his father's, bought for a funeral and never retired. He had not worn a belt since the Obama administration.",
    ],
  ],
];

// Every bible file opens with a one-line summary: that line is what the Story
// bible index shows under each name, so each is written as a real one.
const BIBLE = {
  "canon.md": `The Lift: everyone in Dayton rises into the sky belt buckle first, calmly. Dale is the exception.

# Canon

- The sky takes people by the belt line. The heavier the buckle, the faster the climb.
- Nobody has seen the aliens. They talk only through signs on the water tower.
- The Lift began on a Tuesday and had most of Dayton by Wednesday night.
- Dale wears suspenders (his father's, red). Do not explain this before chapter 8.
`,
  "plot.md": `Dale tries to find out why the sky keeps skipping him before it changes its mind.

# Plot

1. Tuesday the arrival, Wednesday the Lift.
2. Dale checks everything he can think of: pockets, signs, the sky.
3. The signs say some will be lifted later. Dale does not trust "later".
`,
  "style.md": `Deadpan, close third on Dale. Short paragraphs, one joke each, then get out.

# Style

- Never explain the joke. End the paragraph on the funniest word.
- No aliens on the page. The sky behaves like a very polite bureaucracy.
`,
  "timeline.md": `Tuesday the aliens arrive, Wednesday the Lift, Thursday the signs, Friday Dale asks the sky.

# Timeline

- Tuesday, 7:40 pm: bowling night is cancelled.
- Wednesday, 2:14 pm: Rhonda goes up past the bank sign.
- Thursday: the water tower speaks.
`,
  "world.md": `Dayton, Ohio, the week the sky started collecting people.

# World

- The grocery on Dorothy Lane is the last place with the lights on.
- The Strike Zone bowling alley is empty and still plays music.
`,
};

const CHARACTERS = [
  {
    name: "Dale Pruitt",
    summary: "Dale Pruitt, 44, dental floss rep and the only person in Dayton the sky keeps skipping.",
    role: "Narrator. Wants to be taken, then wants to know why he is not.",
    body: "## Description\nForty-four. Red suspenders, a sales lanyard he forgets to take off, and a bowling average of 143 that he defends.\n\n## Arc\nFrom a man who wants to be lifted to a man who wants an explanation.\n\n## Voice\n> How they speak: diction, rhythm, tics.\nPolite to the point of accusation. Asks a question, then answers it himself.",
  },
  {
    name: "Rhonda Pruitt",
    summary: "Rhonda Pruitt, Dale's ex-wife, who always said she wanted a bigger life.",
    role: "Ex-wife. First of the main cast to go up.",
    body: "## Description\nForty-two. Hazel eyes, a laugh like a car alarm, and a habit of finishing Dale's sentences wrong.\n\n## Arc\nAlready gone by chapter 3; the book keeps checking what she left behind.\n\n## Voice\n> How they speak: diction, rhythm, tics.\nCheerful and final. Never repeats herself.",
  },
  {
    name: "Gary Oyelaran",
    summary: "Gary Oyelaran from Accounts, owner of the rodeo buckle and the first man up on Wednesday.",
    role: "Dale's colleague. Left the building like a cork.",
    body: "## Description\nFifty. Broad, cheerful, a buckle the size of a hubcap.\n\n## Arc\nGone early. His wife stays on the ground long enough to notice the suspenders.\n\n## Voice\n> How they speak: diction, rhythm, tics.\nBooms. Calls everyone \u201cchief\u201d.",
  },
];

const WORDS = (n) => n; // readability: a day's words
// Days back from today -> words. Today is partway to the 250 goal; the last
// seven days hold four written days; the month behind it fills the history.
const DAYS = [
  [0, 140, 11 * 60_000],
  [1, 312, 27 * 60_000],
  [2, 268, 22 * 60_000],
  [4, 410, 38 * 60_000],
  [8, 300, 24 * 60_000],
  [9, 220, 17 * 60_000],
  [11, 350, 31 * 60_000],
  [13, 180, 14 * 60_000],
  [15, 290, 23 * 60_000],
  [16, 260, 21 * 60_000],
  [18, 330, 29 * 60_000],
  [20, 240, 19 * 60_000],
  [22, 275, 22 * 60_000],
  [25, 300, 25 * 60_000],
  [27, 210, 16 * 60_000],
];

function dayKey(daysBack) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// A short script from the same world, in the phone's screenplay mode (Beta).
// The element is the data-sp tag; an action line carries none (see
// docs/screenplay.md). No parenthetical, so the page view and the editor agree.
const SCRIPT = [
  ["scene-heading", "INT. DAYTON DMV - DAY"],
  ["action", "Every chair is empty. The whole room hangs from the ceiling, belt buckle first. DALE PRUITT, 44, holds number 47."],
  ["character", "CLERK"],
  ["dialogue", "Number forty-seven."],
  ["character", "DALE"],
  ["dialogue", "That's me. I'm down here."],
  ["character", "CLERK"],
  ["dialogue", "You'll have to come up."],
  ["character", "DALE"],
  ["dialogue", "I would love to."],
  ["transition", "CUT TO:"],
  ["scene-heading", "EXT. DMV PARKING LOT - CONTINUOUS"],
  ["action", "Dale checks his pockets, in case he was issued something. He wasn't."],
];

async function seedScript() {
  const project = await api("/api/projects", {
    method: "POST",
    body: { title: "Number Forty-Seven", author: DEMO.name, kind: "screenplay", genre: "Short film" },
  });
  const chapter = project.chapters[0];
  const content = SCRIPT.map(([tag, text], i) =>
    tag === "action" ? p(i + 1, text) : `<p data-block-id="b${i + 1}" data-sp="${tag}">${text}</p>`
  ).join("");
  await api(`/api/chapters/${chapter.id}`, { method: "PATCH", body: { content, expectedRevision: chapter.revision } });
  console.log("script", project.id);
}

async function main() {
  try {
    await api("/api/auth/signup", { method: "POST", body: { ...DEMO, marketingOptIn: false } });
    console.log("signed up", DEMO.email);
  } catch (e) {
    if (!/exist|already|409/i.test(String(e))) throw e;
    await api("/api/auth/login", { method: "POST", body: { email: DEMO.email, password: DEMO.password } });
    console.log("signed in", DEMO.email);
  }

  let existing = await api("/api/projects");
  if (process.argv.includes("--reset") && Array.isArray(existing)) {
    for (const x of existing) await api(`/api/projects/${x.id}`, { method: "DELETE" });
    console.log("deleted", existing.length, "manuscripts");
    existing = [];
  }
  const have = (title) => Array.isArray(existing) && existing.some((x) => x.title === title);
  if (!have("Number Forty-Seven")) await seedScript();
  if (have("Belt Buckle First")) {
    console.log("Belt Buckle First already exists; leaving the seed as it is. Re-run with --reset to reseed.");
    return;
  }

  const project = await api("/api/projects", {
    method: "POST",
    body: {
      title: "Belt Buckle First",
      author: DEMO.name,
      genre: "Satire",
      kind: "novel",
      logline: "The sky is collecting everyone in Dayton, belt buckle first. Dale Pruitt would like to know why it skipped him.",
    },
  });
  const projectId = project.id;
  console.log("project", projectId);

  const chapters = [project.chapters[0]];
  for (let i = 1; i < CHAPTERS.length; i++) {
    chapters.push(await api("/api/chapters", { method: "POST", body: { projectId, title: CHAPTERS[i][0] } }));
  }
  for (let i = 0; i < CHAPTERS.length; i++) {
    const [title, paragraphs] = CHAPTERS[i];
    await api(`/api/chapters/${chapters[i].id}`, {
      method: "PATCH",
      body: { title, content: html(paragraphs), expectedRevision: chapters[i].revision },
    });
  }
  console.log("chapters", CHAPTERS.length);

  // The five default bible files get a real one-line summary, then the characters.
  for (const [path, content] of Object.entries(BIBLE)) {
    const file = await api(`/api/bible?projectId=${projectId}&path=${encodeURIComponent(path)}`);
    await api("/api/bible", { method: "POST", body: { projectId, path, content, expectedRevision: file.revision } });
  }
  for (const c of CHARACTERS) {
    const file = await api("/api/bible", { method: "POST", body: { projectId, newCharacter: c.name } });
    await api("/api/bible", {
      method: "POST",
      body: {
        projectId,
        path: file.path,
        content: `${c.summary}\n\n# ${c.name}\n> Character\n\n**Role:** ${c.role}\n\n${c.body}\n`,
        expectedRevision: file.revision,
      },
    });
  }
  console.log("bible", Object.keys(BIBLE).length + CHARACTERS.length, "files");

  for (const [back, words, activeMs] of DAYS) {
    await api("/api/writing/day", { method: "PUT", body: { date: dayKey(back), words: WORDS(words), activeMs } });
  }
  console.log("writing days", DAYS.length);

  // The weekly review: written by hand because the real one is a model call.
  const require = createRequire(`${REPO}/package.json`);
  process.env.DATABASE_URL ??= `file:${resolve(args.db ?? `${REPO}/prisma/dev.db`)}`;
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient();
  try {
    const week = DAYS.filter(([back]) => back <= 6);
    // Real chapter word counts, as the server would report them.
    const wordsOf = (paragraphs) => paragraphs.join(" ").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
    const touched = [6, 5, 3].map((i) => ({ id: chapters[i].id, title: CHAPTERS[i][0], wordCount: wordsOf(CHAPTERS[i][1]) }));
    const totalWords = CHAPTERS.reduce((n, [, paragraphs]) => n + wordsOf(paragraphs), 0);
    await db.weeklyReview.create({
      data: {
        projectId,
        weekStart: dayKey(6),
        weekEnd: dayKey(0),
        stats: JSON.stringify({
          words: week.reduce((n, [, w]) => n + w, 0),
          daysWritten: week.length,
          activeMs: week.reduce((n, [, , ms]) => n + ms, 0),
          days: Array.from({ length: 7 }, (_, i) => {
            const back = 6 - i;
            const hit = week.find(([b]) => b === back);
            return { date: dayKey(back), words: hit ? hit[1] : 0 };
          }),
          chaptersTouched: touched,
          totalWords,
          chapterCount: CHAPTERS.length,
          openQuestions: 2,
          openThreads: 3,
        }),
        content: JSON.stringify({
          summary:
            "A steady week: four days at the page, and Dale went from the grocery parking lot to the foot of the water tower. The signs are the best thing you wrote. They are funny because nobody in the book thinks they are.",
          looseEnds: [
            "Dale checked his pockets in Chapter 1 in case he had been issued something. The book has not said what he hoped to find.",
            "The signs say some of you will be lifted later. Nobody has asked who decides.",
            "Gary's wife noticed the suspenders from four feet up, and no one has mentioned them since.",
          ],
          nextSteps: [
            "Let Dale try to get lifted on purpose: a ladder, a very large buckle, anything.",
            "Give the water tower one more sign, and make this one personal.",
            "Note in the story bible who in Dayton owns a belt, and who does not.",
          ],
        }),
      },
    });
  } finally {
    await db.$disconnect();
  }
  console.log("weekly review");
  console.log(`\nDemo account: ${DEMO.email} / ${DEMO.password}\nProject id: ${projectId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
