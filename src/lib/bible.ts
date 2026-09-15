import { prisma } from "@/lib/db";
import { AuthError } from "@/lib/auth/session";

// The story bible is a set of markdown files, one concern per path. These are
// the shared memory between the editor (Opus) and the drafters (Sonnet/Haiku):
// the editor reads them to plan and writes decisions back so nothing important
// is ever lost to chat scrollback.
//
// Stored as BibleFile rows (D1 on the hosted Worker, sqlite locally):
//
//   canon.md        - hard facts + author rulings (the decision log)
//   plot.md         - structure, beats, open loops, payoffs
//   style.md        - POV, tense, prose rules, dialogue conventions, do/don'ts
//   timeline.md     - chronology
//   world.md        - settings, lore, rules
//   characters/<slug>.md
//   plot/<slug>.md  - individual plot lines / threads
//
// Every file opens with a one-line summary (that is the index the editor sees
// without loading full contents).

export type BibleFileRecord = {
  path: string;
  content: string;
  revision: number;
};

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unnamed"
  );
}

// Resolve a bible-relative path safely, rejecting traversal, absolute paths,
// and anything that is not a markdown file.
export function normalizeBiblePath(relPath: string): string {
  const trimmed = relPath.trim().replace(/\\/g, "/");
  if (!trimmed) throw new Error("Bible path required");
  if (trimmed.startsWith("/") || trimmed.startsWith("~")) {
    throw new Error(`Path escapes bible directory: ${relPath}`);
  }
  if (/^[a-zA-Z]:/.test(trimmed) || trimmed.includes("://")) {
    throw new Error(`Path escapes bible directory: ${relPath}`);
  }
  const parts = trimmed.split("/").filter((part) => part && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === "..")) {
    throw new Error(`Path escapes bible directory: ${relPath}`);
  }
  const normalized = parts.join("/");
  if (!normalized.endsWith(".md")) {
    throw new Error(`Bible files must be .md: ${relPath}`);
  }
  return normalized;
}

function summaryOf(content: string): string {
  return (
    content
      .split("\n")
      .map((l) => l.replace(/^#+\s*/, "").replace(/^>\s*/, "").trim())
      .find((l) => l.length > 0) || "(empty)"
  ).slice(0, 140);
}

export async function getBibleFile(
  projectId: string,
  relPath: string
): Promise<BibleFileRecord | null> {
  const path = normalizeBiblePath(relPath);
  const row = await prisma.bibleFile.findUnique({
    where: { projectId_path: { projectId, path } },
    select: { path: true, content: true, revision: true },
  });
  return row;
}

export async function readBibleFile(
  projectId: string,
  relPath: string
): Promise<string> {
  const row = await getBibleFile(projectId, relPath);
  return row?.content ?? "";
}

export async function writeBibleFile(
  projectId: string,
  relPath: string,
  content: string,
  expectedRevision?: number
): Promise<BibleFileRecord> {
  const path = normalizeBiblePath(relPath);
  const existing = await prisma.bibleFile.findUnique({
    where: { projectId_path: { projectId, path } },
    select: { id: true, revision: true },
  });

  if (!existing) {
    if (expectedRevision !== undefined && expectedRevision !== 0) {
      throw new AuthError("Bible revision conflict", 409, {
        error: "Bible revision conflict",
        path,
        expectedRevision,
        currentRevision: 0,
      });
    }
    const created = await prisma.bibleFile.create({
      data: { projectId, path, content, revision: 0 },
      select: { path: true, content: true, revision: true },
    });
    return created;
  }

  if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
    throw new AuthError("Bible revision conflict", 409, {
      error: "Bible revision conflict",
      path,
      expectedRevision,
      currentRevision: existing.revision,
    });
  }

  const nextRevision = existing.revision + 1;
  const updated = await prisma.bibleFile.updateMany({
    where:
      expectedRevision === undefined
        ? { id: existing.id }
        : { id: existing.id, revision: expectedRevision },
    data: { content, revision: nextRevision },
  });
  if (updated.count !== 1) {
    const current = await prisma.bibleFile.findUnique({
      where: { id: existing.id },
      select: { revision: true },
    });
    throw new AuthError("Bible revision conflict", 409, {
      error: "Bible revision conflict",
      path,
      expectedRevision: expectedRevision ?? existing.revision,
      currentRevision: current?.revision ?? existing.revision,
    });
  }
  return { path, content, revision: nextRevision };
}

export async function appendCanon(
  projectId: string,
  note: string
): Promise<void> {
  const rel = "canon.md";
  const existing = await getBibleFile(projectId, rel);
  const stamp = new Date().toISOString().slice(0, 10);
  const line = `- (${stamp}) ${note.trim()}`;
  const current = existing?.content ?? "";
  const next = current.trim()
    ? `${current.trimEnd()}\n${line}\n`
    : `# Canon\n> Hard facts and author rulings the story must never contradict.\n\n${line}\n`;
  await writeBibleFile(
    projectId,
    rel,
    next,
    existing ? existing.revision : undefined
  );
}

export type BibleEntry = { path: string; summary: string };

// List every bible file with its first non-empty line as a summary. This is the
// cheap index the editor sees; it reads full files on demand.
export async function listBible(projectId: string): Promise<BibleEntry[]> {
  const rows = await prisma.bibleFile.findMany({
    where: { projectId },
    select: { path: true, content: true },
    orderBy: { path: "asc" },
  });
  return rows.map((row) => ({
    path: row.path,
    summary: summaryOf(row.content),
  }));
}

export async function listBibleFiles(
  projectId: string,
  afterRevisionByPath?: Record<string, number>
): Promise<BibleFileRecord[]> {
  const rows = await prisma.bibleFile.findMany({
    where: { projectId },
    select: { path: true, content: true, revision: true },
    orderBy: { path: "asc" },
  });
  if (!afterRevisionByPath) return rows;
  return rows.filter((row) => {
    const after = afterRevisionByPath[row.path];
    return after === undefined || row.revision > after;
  });
}

const STARTERS: Record<string, (p: SeedProject) => string> = {
  "canon.md": (p) =>
    `# Canon\n> Hard facts and author rulings the story must never contradict.\n\n` +
    (p.pov ? `- POV / tense: ${p.pov}\n` : "") +
    (p.logline ? `- Logline: ${p.logline}\n` : ""),
  "plot.md": (p) =>
    `# Plot\n> Structure, beats, and open loops (setups awaiting payoff).\n\n` +
    (p.synopsis ? `## Premise\n${p.synopsis}\n\n` : "") +
    `## Open loops\n` +
    (p.plotPoints.length
      ? p.plotPoints
          .map(
            (pt) =>
              `- [${pt.status === "resolved" ? "x" : " "}] (${pt.type}) ${pt.title}${
                pt.description ? ` - ${pt.description}` : ""
              }`
          )
          .join("\n") + "\n"
      : "- (none yet)\n"),
  "style.md": (p) =>
    `# Style\n> Voice, POV, tense, prose rules, and dialogue conventions.\n\n` +
    (p.pov ? `- POV / tense: ${p.pov}\n` : "") +
    (p.genre ? `- Genre: ${p.genre}\n` : "") +
    (p.theme ? `- Theme to keep language aligned to: ${p.theme}\n` : "") +
    `- Never use em dashes; use a hyphen "-".\n` +
    `\n## Narrator\n> Who tells the story, what they know, how reliable, and how they change.\n> A first-person narrator also gets their own character file.\n- ${
      p.pov || "(define the POV and who narrates)"
    }\n` +
    (p.notes ? `\n## Notes\n${p.notes}\n` : ""),
  "timeline.md": () =>
    `# Timeline\n> Chronology of events, on and off the page.\n\n- (add events)\n`,
  "world.md": () =>
    `# World\n> Settings, lore, and rules of the story world.\n\n- (add worldbuilding)\n`,
};

type SeedProject = {
  pov: string;
  logline: string;
  synopsis: string;
  genre: string;
  theme: string;
  notes: string;
  plotPoints: { title: string; description: string; type: string; status: string }[];
  characters: {
    name: string;
    role: string;
    description: string;
    arc: string;
    notes: string;
  }[];
};

export function emptyCharacterFile(name: string): string {
  return `# ${name}\n> Character\n\n**Role:** \n\n## Description\n\n## Arc\n\n## Voice\n> How they speak: diction, rhythm, tics.\n`;
}

export function emptyPlotLineFile(name: string): string {
  return (
    `# ${name}\n> Plot line — a beat, loop, or thread the story must pay off.\n\n` +
    `## Setup\n\n## Stakes\n\n## Payoff\n`
  );
}

export async function createNamedBibleFile(
  projectId: string,
  kind: "character" | "plot",
  name: string
): Promise<BibleFileRecord> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name required");
  const path =
    kind === "character"
      ? `characters/${slugify(trimmed)}.md`
      : `plot/${slugify(trimmed)}.md`;
  const content = kind === "character" ? emptyCharacterFile(trimmed) : emptyPlotLineFile(trimmed);
  return writeBibleFile(projectId, path, content);
}

function characterFile(c: SeedProject["characters"][number]): string {
  return (
    `# ${c.name}\n> ${c.role || "Character"}${
      c.description ? ` - ${c.description.split("\n")[0]}` : ""
    }\n\n` +
    (c.role ? `**Role:** ${c.role}\n\n` : "") +
    (c.description ? `## Description\n${c.description}\n\n` : "") +
    (c.arc ? `## Arc\n${c.arc}\n\n` : "") +
    `## Voice\n> How they speak: diction, rhythm, tics.\n${
      c.notes ? c.notes + "\n" : "- (describe their voice)\n"
    }`
  );
}

function plotLineFile(pt: SeedProject["plotPoints"][number]): string {
  return (
    `# ${pt.title}\n> ${pt.type || "Plot line"} — a beat, loop, or thread the story must pay off.\n\n` +
    (pt.description ? `## Setup\n${pt.description}\n\n` : `## Setup\n\n`) +
    `## Stakes\n\n## Payoff\n`
  );
}

// Seed bible rows from the project's existing DB records the first time a
// path is missing. After this, the rows are the source of truth.
export async function ensureBible(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      characters: { orderBy: { name: "asc" } },
      plotPoints: { orderBy: { order: "asc" } },
    },
  });
  if (!project) return;

  const existing = await prisma.bibleFile.findMany({
    where: { projectId },
    select: { path: true },
  });
  const have = new Set(existing.map((row) => row.path));

  const seed: SeedProject = {
    pov: project.pov,
    logline: project.logline,
    synopsis: project.synopsis,
    genre: project.genre,
    theme: project.theme,
    notes: project.notes,
    plotPoints: project.plotPoints,
    characters: project.characters,
  };

  for (const [name, make] of Object.entries(STARTERS)) {
    if (have.has(name)) continue;
    await writeBibleFile(projectId, name, make(seed));
  }
  for (const c of seed.characters) {
    const path = `characters/${slugify(c.name)}.md`;
    if (have.has(path)) continue;
    await writeBibleFile(projectId, path, characterFile(c));
  }
  for (const pt of seed.plotPoints) {
    const path = `plot/${slugify(pt.title)}.md`;
    if (have.has(path)) continue;
    await writeBibleFile(projectId, path, plotLineFile(pt));
  }
}
