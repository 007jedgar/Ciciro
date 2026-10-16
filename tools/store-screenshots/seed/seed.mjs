#!/usr/bin/env node
// Seeds a LOCAL Ciciro server with the sample manuscript the captures show:
// "The Letter" by Nell Harrow, the same fictional book the homepage uses.
// Never point it at production (it refuses a non-local base URL).
//
//   node seed/seed.mjs [--base http://localhost:3187] [--db ../../prisma/dev.db]
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

export const DEMO = { email: "store-shots@ciciro.test", password: "Letter-2026-demo", name: "Nell Harrow" };

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

// Twelve chapters. Only 11 and 12 are shown in full; the rest are short real
// scenes so the book reads as a book in lists and the "previously on" recap.
const CHAPTERS = [
  ["The Harbour", ["Mara came back to Saltgate in the last week of October, when the ferry ran only twice a day and the gulls had the quay to themselves.", "Nobody met her. She had not told anyone which boat."]],
  ["Ines", ["Her aunt's house stood at the top of Fish Row, narrow as a held breath. Ines Lind opened the door before Mara could knock.", "“You look like your mother,” Ines said, and went to put the kettle on, which was how Mara knew the conversation was over."]],
  ["Low Tide", ["At low tide the harbour showed its ribs: old moorings, a bicycle, a rope nobody had hauled in for years.", "Mara walked out along the mud with her boots in her hand, not looking for anything, and found the brass key."]],
  ["The Dockmaster", ["The dockmaster kept his log in pencil, so that nothing in it would ever have to be permanent.", "“Six years,” he said, looking at the key and not at her. “Your brother left it on my desk the night he went.”"]],
  ["What the Lamps Showed", ["The lamps came on along the wall one at a time, as they always had, and for the first time she noticed they did not light the same stretch of water twice."]],
  ["A Week of Rain", ["It rained for seven days. Mara read the shipping notices in the post office window and learned the names of boats that no longer sailed."]],
  ["Her Brother's Boat", ["The Wren was still on the slip, under a tarpaulin gone green. Someone had been oiling the hinges on the cabin door."]],
  ["The Ferry", ["She took the morning ferry to the mainland and came back on the evening one, which was the longest day she had spent doing nothing in her life."]],
  ["Salt", ["Ines salted everything. Fish, bread, the occasional argument. “It keeps,” she said, when Mara asked why."]],
  ["Ines Speaks", ["Ines told it in the dark, with the lamp off, the way you tell the things you have been practising for years.", "When she finished, neither of them reached for the light."]],
  [
    "The Return",
    [
      `She ${SUGGEST("11a", "walked slowly to", "crossed to")} the door and stood there ${SUGGEST("11b", "for a while, which was, in the end, what she actually did, for what felt to her like a very long time", "for a long time")}.`,
      "Behind her the stove ticked as it cooled. The house had the held, waiting quiet of a place that already knows what you are about to say.",
      `The tide ${SUGGEST("11c", "was in the process of turning", "was turning")}, and she could hear it before she could see it, the small sounds of water finding its way back in among the stones.`,
    ],
  ],
  [
    "The Letter",
    [
      "The harbour had gone quiet by the time she reached the steps, and the lamps were only just coming on along the wall.",
      "Mara took the letter from her coat pocket, the paper gone soft at the folds. She didn't need to unfold it, only to feel the weight of it, warm from her pocket.",
    ],
  ],
];

const CHARACTERS = [
  {
    name: "Mara",
    role: "Protagonist. Back in Saltgate after six years.",
    body: "## Description\nThirty-four. Grey coat, dark hair she keeps cutting herself. Chews the cord of her hood when she is deciding something.\n\n## Arc\nFrom someone who left without a word to someone who stays long enough to hear the answer.\n\n## Voice\n> How they speak: diction, rhythm, tics.\nDry, short sentences. Answers a question with a smaller question.",
  },
  {
    name: "Ines Lind",
    role: "Mara's aunt. Net-mender, keeper of the house on Fish Row.",
    body: "## Description\nSeventy-one. Grey eyes, a net-mender's hands, a habit of salting everything. Hums when she is lying.\n\n## Arc\nTells the truth only when the lamp is off.\n\n## Voice\n> How they speak: diction, rhythm, tics.\nPlain and unhurried. Never uses Mara's name when she is angry.",
  },
  {
    name: "The Dockmaster",
    role: "Keeps the harbour log, in pencil.",
    body: "## Description\nSixty, broad, sunburnt in every season. Reads the tide table like scripture.\n\n## Arc\nHas held the brass key for six years and wants it gone.\n\n## Voice\n> How they speak: diction, rhythm, tics.\nSlow. Says “well” before every answer.",
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

async function main() {
  try {
    await api("/api/auth/signup", { method: "POST", body: { ...DEMO, marketingOptIn: false } });
    console.log("signed up", DEMO.email);
  } catch (e) {
    if (!/exist|already|409/i.test(String(e))) throw e;
    await api("/api/auth/login", { method: "POST", body: { email: DEMO.email, password: DEMO.password } });
    console.log("signed in", DEMO.email);
  }

  const existing = await api("/api/projects");
  if (Array.isArray(existing) && existing.some((x) => x.title === "The Letter")) {
    console.log("The Letter already exists; leaving the seed as it is. Delete the account's data to reseed.");
    return;
  }

  const project = await api("/api/projects", {
    method: "POST",
    body: {
      title: "The Letter",
      author: DEMO.name,
      genre: "Literary fiction",
      kind: "novel",
      logline: "A woman returns to her harbour town and finds the letter her brother left for her six years ago.",
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

  for (const c of CHARACTERS) {
    const file = await api("/api/bible", { method: "POST", body: { projectId, newCharacter: c.name } });
    await api("/api/bible", {
      method: "POST",
      body: {
        projectId,
        path: file.path,
        content: `# ${c.name}\n> Character\n\n**Role:** ${c.role}\n\n${c.body}\n`,
        expectedRevision: file.revision,
      },
    });
  }
  console.log("characters", CHARACTERS.length);

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
    const touched = [11, 10, 9].map((i) => ({ id: chapters[i].id, title: CHAPTERS[i][0], wordCount: 120 }));
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
          totalWords: 2400,
          chapterCount: CHAPTERS.length,
          openQuestions: 2,
          openThreads: 3,
        }),
        content: JSON.stringify({
          summary:
            "A steady week: four days at the page, and the book moved from Ines's confession into Mara walking down to the harbour with the letter. The Return sets the mood well. The house, the stove, the tide all say the same thing without being told to.",
          looseEnds: [
            "Who left the brass key on the dockmaster's desk, and why was it six years before anyone mentioned it?",
            "The Wren's cabin hinges are freshly oiled. Someone has been aboard, and the book has not said who.",
            "Ines hums when she is lying. She is humming in Chapter 10, and Mara has not noticed.",
          ],
          nextSteps: [
            "Finish Chapter 12 by letting Mara read the first line, then decide whether to read the rest tonight.",
            "Give the dockmaster one more scene before the letter is opened, so his silence has weight.",
            "Walk the Wren's slip once more in your head, and note in the story bible who has a key.",
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
