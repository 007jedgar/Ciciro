import { Packer } from "docx";
import { prisma } from "@/lib/db";
import { buildManuscriptDocx } from "@/lib/docx";
import { buildChapterMarkdown, markdownTitleBlock } from "@/lib/export/markdown";
import { htmlWithoutSuggestions } from "@/lib/suggestions";
import { ZipWriter, streamFromChunks } from "@/lib/account/zip-stream";

// "Export my data": every row the account owns as JSON, plus each manuscript
// as Markdown and Word, streamed as one zip. Built for a Worker's memory: each
// table is read a page at a time and compressed straight into the response,
// so memory tracks the largest page, not the account. See docs/account-data.md.

type Row = Record<string, unknown>;

type Table = {
  /** Prisma model name; test/account-export.integration.test.ts checks coverage. */
  model: string;
  file: string;
  /** Rows per query: small for tables whose rows carry whole chapters or transcripts. */
  take: number;
  page: (userId: string, after: string | undefined, take: number) => Promise<Row[]>;
  /** Drop secrets and unpack JSON-in-a-string columns. */
  shape?: (row: Row) => Row;
};

/**
 * Manuscripts longer than this get Markdown only. The Word builder holds the
 * whole document in memory several times over (about 30 bytes per character
 * of prose), which would not fit in a Worker for a very long manuscript.
 */
export const DOCX_WORD_BUDGET = 250_000;

const CHAPTER_PAGE = 20;

function after(id: string | undefined) {
  return id ? { id: { gt: id } } : {};
}

function own(userId: string) {
  return { project: { userId } };
}

const byId = { orderBy: { id: "asc" as const } };

/** Parse a JSON column for the export, keeping the raw text if it is not JSON. */
function parsed(value: unknown): unknown {
  if (typeof value !== "string" || !value) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function without(row: Row, ...keys: string[]): Row {
  const copy = { ...row };
  for (const key of keys) delete copy[key];
  return copy;
}

function unpack(row: Row, ...keys: string[]): Row {
  const copy = { ...row };
  for (const key of keys) copy[key] = parsed(copy[key]);
  return copy;
}

/**
 * One JSON file per table the account reaches. `User` is written separately
 * (data/account.json) because it is a single object, not a list.
 */
export const EXPORT_TABLES: readonly Table[] = [
  {
    model: "Session",
    file: "sign-in-sessions",
    take: 200,
    page: (userId, id, take) =>
      prisma.session.findMany({ where: { userId, ...after(id) }, ...byId, take }),
    // Only the device and dates: the token hash is a credential.
    shape: (row) => without(row, "tokenHash"),
  },
  {
    model: "Identity",
    file: "linked-sign-ins",
    take: 50,
    page: (userId, id, take) =>
      prisma.identity.findMany({ where: { userId, ...after(id) }, ...byId, take }),
    // Which provider and email are linked; the Apple refresh token is a credential.
    shape: (row) => without(row, "refreshToken", "refreshTokenClientId"),
  },
  {
    model: "AuthHandoff",
    file: "pending-app-sign-ins",
    take: 50,
    page: (userId, id, take) =>
      prisma.authHandoff.findMany({ where: { userId, ...after(id) }, ...byId, take }),
    // The code hash and PKCE challenge only redeem a sign-in.
    shape: (row) => without(row, "codeHash", "challenge"),
  },
  {
    model: "EmailToken",
    file: "email-links",
    take: 200,
    page: (userId, id, take) =>
      prisma.emailToken.findMany({ where: { userId, ...after(id) }, ...byId, take }),
    // What was sent where and when; the token hash is a credential.
    shape: (row) => without(row, "tokenHash"),
  },
  {
    model: "PushToken",
    file: "push-notification-devices",
    take: 200,
    page: (userId, id, take) =>
      prisma.pushToken.findMany({ where: { userId, ...after(id) }, ...byId, take }),
    // Which platform and when; the token itself can send to that phone.
    shape: (row) => without(row, "token"),
  },
  {
    model: "PushTicket",
    file: "push-notification-receipts",
    take: 500,
    page: (userId, id, take) =>
      prisma.pushTicket.findMany({ where: { pushToken: { userId }, ...after(id) }, ...byId, take }),
  },
  {
    model: "Folder",
    file: "folders",
    take: 200,
    page: (userId, id, take) =>
      prisma.folder.findMany({ where: { userId, ...after(id) }, ...byId, take }),
  },
  {
    model: "Project",
    file: "manuscripts",
    take: 50,
    page: (userId, id, take) =>
      prisma.project.findMany({ where: { userId, ...after(id) }, ...byId, take }),
  },
  {
    model: "ManuscriptTarget",
    file: "manuscript-targets",
    take: 200,
    page: (userId, id, take) =>
      prisma.manuscriptTarget.findMany({ where: { ...own(userId), ...after(id) }, ...byId, take }),
  },
  {
    model: "Chapter",
    file: "chapters",
    take: CHAPTER_PAGE,
    page: (userId, id, take) =>
      prisma.chapter.findMany({ where: { ...own(userId), ...after(id) }, ...byId, take }),
  },
  {
    model: "ChapterOp",
    file: "chapter-edit-log",
    take: 500,
    page: (userId, id, take) =>
      prisma.chapterOp.findMany({ where: { ...own(userId), ...after(id) }, ...byId, take }),
    shape: (row) => unpack(row, "payload"),
  },
  {
    model: "ChapterSnapshot",
    file: "chapter-snapshots",
    take: CHAPTER_PAGE,
    page: (userId, id, take) =>
      prisma.chapterSnapshot.findMany({ where: { ...own(userId), ...after(id) }, ...byId, take }),
  },
  {
    model: "ManuscriptEdit",
    file: "editor-corrections",
    take: 200,
    page: (userId, id, take) =>
      prisma.manuscriptEdit.findMany({
        where: { chapter: own(userId), ...after(id) },
        ...byId,
        take,
      }),
  },
  {
    model: "ScratchNote",
    file: "scratch-notes",
    take: 50,
    page: (userId, id, take) =>
      prisma.scratchNote.findMany({ where: { ...own(userId), ...after(id) }, ...byId, take }),
  },
  {
    model: "BibleFile",
    file: "story-bible-files",
    take: 50,
    page: (userId, id, take) =>
      prisma.bibleFile.findMany({ where: { ...own(userId), ...after(id) }, ...byId, take }),
  },
  {
    model: "Character",
    file: "characters",
    take: 200,
    page: (userId, id, take) =>
      prisma.character.findMany({ where: { ...own(userId), ...after(id) }, ...byId, take }),
  },
  {
    model: "PlotPoint",
    file: "plot-points",
    take: 200,
    page: (userId, id, take) =>
      prisma.plotPoint.findMany({ where: { ...own(userId), ...after(id) }, ...byId, take }),
  },
  {
    model: "OpenQuestion",
    file: "open-questions",
    take: 200,
    page: (userId, id, take) =>
      prisma.openQuestion.findMany({ where: { ...own(userId), ...after(id) }, ...byId, take }),
  },
  {
    model: "ChatMessage",
    file: "chat-messages",
    take: 50,
    page: (userId, id, take) =>
      prisma.chatMessage.findMany({ where: { ...own(userId), ...after(id) }, ...byId, take }),
  },
  {
    model: "ChatBlob",
    file: "chat-attachments",
    take: 20,
    page: (userId, id, take) =>
      prisma.chatBlob.findMany({ where: { ...own(userId), ...after(id) }, ...byId, take }),
  },
  {
    model: "DraftInsertion",
    file: "draft-insertions",
    take: 200,
    page: (userId, id, take) =>
      prisma.draftInsertion.findMany({ where: { ...own(userId), ...after(id) }, ...byId, take }),
  },
  {
    model: "EditorRun",
    file: "editor-runs",
    // A run's transcript can run to megabytes.
    take: 5,
    page: (userId, id, take) =>
      prisma.editorRun.findMany({ where: { ...own(userId), ...after(id) }, ...byId, take }),
    shape: (row) => unpack(without(row, "lockToken"), "messagesJson", "verificationJson"),
  },
  {
    model: "EditorStep",
    file: "editor-run-steps",
    take: 20,
    page: (userId, id, take) =>
      prisma.editorStep.findMany({ where: { run: own(userId), ...after(id) }, ...byId, take }),
    shape: (row) => unpack(row, "modelResponseJson", "toolResultsJson"),
  },
  {
    model: "ProjectRecap",
    file: "recaps",
    take: 100,
    page: (userId, id, take) =>
      prisma.projectRecap.findMany({ where: { ...own(userId), ...after(id) }, ...byId, take }),
  },
  {
    model: "WeeklyReview",
    file: "weekly-reviews",
    take: 100,
    page: (userId, id, take) =>
      prisma.weeklyReview.findMany({ where: { ...own(userId), ...after(id) }, ...byId, take }),
    shape: (row) => unpack(row, "stats", "content"),
  },
  {
    model: "ShareLink",
    file: "share-links",
    take: 200,
    page: (userId, id, take) =>
      prisma.shareLink.findMany({ where: { ...own(userId), ...after(id) }, ...byId, take }),
    // The token is the link's credential; the label and scope say which link it was.
    shape: (row) => unpack(without(row, "token"), "chapterIds"),
  },
  {
    model: "ShareComment",
    file: "beta-reader-comments",
    take: 200,
    page: (userId, id, take) =>
      prisma.shareComment.findMany({ where: { ...own(userId), ...after(id) }, ...byId, take }),
    // A hash of the reader's IP, kept only for rate limiting.
    shape: (row) => without(row, "clientHash"),
  },
  {
    model: "ReadingPosition",
    file: "reading-positions",
    take: 200,
    page: (userId, id, take) =>
      prisma.readingPosition.findMany({ where: { userId, ...after(id) }, ...byId, take }),
  },
  {
    model: "WritingDay",
    file: "writing-days",
    take: 500,
    page: (userId, id, take) =>
      prisma.writingDay.findMany({ where: { userId, ...after(id) }, ...byId, take }),
  },
  {
    model: "WritingSession",
    file: "writing-sessions",
    take: 500,
    page: (userId, id, take) =>
      prisma.writingSession.findMany({ where: { userId, ...after(id) }, ...byId, take }),
  },
  {
    model: "PasswordAttempt",
    file: "account-deletion-attempts",
    take: 200,
    // Only rows tied to this account (failed account-deletion password
    // checks): a login attempt against this email before it was known to be
    // this account has no userId to page by, same as the rate-limit hash of
    // beta readers' IPs below.
    page: (userId, id, take) =>
      prisma.passwordAttempt.findMany({ where: { userId, ...after(id) }, ...byId, take }),
    shape: (row) => without(row, "ipHash", "key"),
  },
  {
    model: "Subscription",
    file: "subscriptions",
    take: 100,
    page: (userId, id, take) =>
      prisma.subscription.findMany({ where: { userId, ...after(id) }, ...byId, take }),
  },
  {
    model: "BillingEvent",
    file: "billing-events",
    take: 500,
    page: (userId, id, take) =>
      prisma.billingEvent.findMany({ where: { userId, ...after(id) }, ...byId, take }),
  },
  {
    model: "UsageCounter",
    file: "ai-usage",
    take: 500,
    page: (userId, id, take) =>
      prisma.usageCounter.findMany({ where: { userId, ...after(id) }, ...byId, take }),
  },
  {
    model: "EmailPreference",
    file: "email-preferences",
    take: 10,
    page: (userId, id, take) =>
      prisma.emailPreference.findMany({ where: { userId, ...after(id) }, ...byId, take }),
    // The unsubscribe token is a link credential (see marketing-send.ts).
    shape: (row) => without(row, "unsubscribeToken"),
  },
  {
    model: "MarketingEmailLog",
    file: "marketing-emails-sent",
    take: 500,
    page: (userId, id, take) =>
      prisma.marketingEmailLog.findMany({ where: { userId, ...after(id) }, ...byId, take }),
  },
];

/** Every model the export covers: the tables above plus the account itself. */
export const EXPORTED_MODELS = ["User", ...EXPORT_TABLES.map((table) => table.model)];

export function exportFilename(now = new Date()): string {
  return `ciciro-data-${now.toISOString().slice(0, 10)}.zip`;
}

const FOLDER_UNSAFE = /[\\/:*?"<>|\u0000-\u001f\u007f]+/g;

/** A zip path segment from a title: no separators, no dot-only names. */
function safeSegment(raw: string, fallback: string): string {
  const cleaned = raw.normalize("NFC").replace(FOLDER_UNSAFE, " ").replace(/\s+/g, " ").trim();
  const trimmed = cleaned.replace(/^\.+/, "").slice(0, 80).trim();
  return trimmed || fallback;
}

/** A bible path kept inside its folder: `../x` and absolute paths lose their escape. */
function safeBiblePath(path: string): string {
  const parts = path
    .split(/[\\/]+/)
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => safeSegment(part, "untitled"));
  return parts.length ? parts.join("/") : "untitled.md";
}

function uniqueName(name: string, taken: Map<string, number>): string {
  const key = name.toLowerCase();
  const seen = taken.get(key) ?? 0;
  taken.set(key, seen + 1);
  return seen ? `${name} (${seen + 1})` : name;
}

function readme(exportedAt: Date): string {
  return `Your Ciciro data
================

Exported ${exportedAt.toISOString()}.

manuscripts/
  One folder per manuscript, readable without Ciciro:
  - <title>.md    the manuscript as Markdown (live chapters, in order)
  - <title>.docx  the same in standard manuscript format, for Word or Pages
                  (manuscripts over ${DOCX_WORD_BUDGET.toLocaleString("en-US")} words are Markdown only)
  - story-bible/  the story bible's files
  - scratchpad.md the manuscript's scratch notes
  Archived chapters and pending suggestions are left out of these copies;
  both are in data/chapters.json.

data/
  Everything Ciciro stores for your account, one JSON file per kind of
  record, each a list of records as stored: account.json (profile and
  settings), manuscripts, chapters (including archived ones and their
  suggestion markup), the chapter edit log and snapshots, story bible files,
  characters, plot points, open questions, scratch notes, chat messages and
  editor runs, recaps, weekly reviews, share links, beta reader comments,
  folders, reading positions, your writing days and sessions, failed
  account-deletion password attempts, the phones registered for
  notifications, your subscriptions, billing events and monthly AI usage,
  and your email preferences and the marketing emails sent to you.

manifest.json
  Written last, with the record count for each file in data/. A zip that
  will not open, or has no manifest.json, is incomplete: export again.

Left out on purpose: your password hash, sign-in session tokens, Apple
sign-in refresh token, pending app sign-in codes, share link
tokens (the links are listed, but not the secret that opens them), your
email-preferences unsubscribe link's token, and the hashed addresses kept
for rate-limiting beta reader comments and password attempts (sign-in and
account-deletion). A login attempt against your email before it matched an
account is not included either, for the same reason.
`;
}

type ManuscriptSummary = { id: string; title: string; author: string };

async function* writeTable(zip: ZipWriter, table: Table, userId: string) {
  let count = 0;
  const entry = zip.entry(`data/${table.file}.json`);
  entry.write("[");
  let cursor: string | undefined;
  let first = true;
  for (;;) {
    const rows = await table.page(userId, cursor, table.take);
    if (!rows.length) break;
    let text = "";
    for (const row of rows) {
      text += `${first ? "\n" : ",\n"}${JSON.stringify(table.shape ? table.shape(row) : row)}`;
      first = false;
      count += 1;
    }
    entry.write(text);
    const chunk = zip.drain();
    if (chunk) yield chunk;
    if (rows.length < table.take) break;
    cursor = rows[rows.length - 1].id as string;
  }
  entry.write(first ? "]\n" : "\n]\n");
  entry.close();
  return count;
}

async function* writeManuscript(
  zip: ZipWriter,
  project: ManuscriptSummary,
  folder: string
) {
  const base = `manuscripts/${folder}/${folder}`;
  const live = { projectId: project.id, archivedAt: null };
  const { _sum } = await prisma.chapter.aggregate({ where: live, _sum: { wordCount: true } });
  const withDocx = (_sum.wordCount ?? 0) <= DOCX_WORD_BUDGET;
  const forDocx: { title: string; content: string; order: number }[] = [];

  const md = zip.entry(`${base}.md`);
  md.write(markdownTitleBlock(project));
  let index = 0;
  let cursor: string | undefined;
  for (;;) {
    const chapters = await prisma.chapter.findMany({
      where: live,
      orderBy: [{ order: "asc" }, { id: "asc" }],
      select: { id: true, title: true, content: true, order: true },
      take: CHAPTER_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const chapter of chapters) {
      // Pending suggestions are not part of the prose until accepted.
      const content = htmlWithoutSuggestions(chapter.content);
      md.write(`\n\n${buildChapterMarkdown({ ...chapter, content }, index).trimEnd()}`);
      if (withDocx) forDocx.push({ title: chapter.title, content, order: chapter.order });
      index += 1;
    }
    const chunk = zip.drain();
    if (chunk) yield chunk;
    if (chapters.length < CHAPTER_PAGE) break;
    cursor = chapters[chapters.length - 1].id;
  }
  md.write("\n");
  md.close();

  if (withDocx) {
    const docx = await Packer.toBuffer(
      buildManuscriptDocx({ title: project.title, author: project.author, chapters: forDocx })
    );
    forDocx.length = 0;
    // A .docx is already a zip; storing it as-is saves compressing it twice.
    zip.file(`${base}.docx`, new Uint8Array(docx.buffer, docx.byteOffset, docx.byteLength), {
      compress: false,
    });
    const chunk = zip.drain();
    if (chunk) yield chunk;
  }

  const bible = await prisma.bibleFile.findMany({
    where: { projectId: project.id },
    orderBy: { path: "asc" },
    select: { path: true, content: true },
  });
  const biblePaths = new Map<string, number>();
  for (const file of bible) {
    zip.file(
      `manuscripts/${folder}/story-bible/${uniqueName(safeBiblePath(file.path), biblePaths)}`,
      file.content
    );
  }

  const notes = await prisma.scratchNote.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "asc" },
    select: { title: true, content: true },
  });
  if (notes.length) {
    const pad = zip.entry(`manuscripts/${folder}/scratchpad.md`);
    notes.forEach((note, i) => {
      pad.write(`${i ? "\n\n" : ""}## ${note.title.trim() || "Untitled note"}\n\n${note.content.trimEnd()}`);
    });
    pad.write("\n");
    pad.close();
  }
  const chunk = zip.drain();
  if (chunk) yield chunk;
}

async function* writeAccountExport(userId: string, exportedAt: Date) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  const zip = new ZipWriter();

  zip.file("README.txt", readme(exportedAt));
  const profile = without(user, "passwordHash", "settingsJson");
  zip.file(
    "data/account.json",
    `${JSON.stringify({ ...profile, settings: parsed(user.settingsJson), exportedAt }, null, 2)}\n`
  );

  const counts: Record<string, number> = { account: 1 };
  for (const table of EXPORT_TABLES) counts[table.file] = yield* writeTable(zip, table, userId);

  const manuscripts = await prisma.project.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, title: true, author: true },
  });
  const folders = new Map<string, number>();
  for (const project of manuscripts) {
    const folder = uniqueName(safeSegment(project.title, "Untitled manuscript"), folders);
    yield* writeManuscript(zip, project, folder);
  }

  zip.file(
    "manifest.json",
    `${JSON.stringify({ completed: true, exportedAt, manuscripts: manuscripts.length, records: counts }, null, 2)}\n`
  );
  zip.end();
  const tail = zip.drain();
  if (tail) yield tail;
}

/** The account's data as a zip byte stream, produced as the reader pulls it. */
export function accountExportStream(userId: string, exportedAt = new Date()): ReadableStream<Uint8Array> {
  return streamFromChunks(writeAccountExport(userId, exportedAt), (error) => {
    console.error("account export failed mid-stream", error);
  });
}
