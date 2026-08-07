import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/db";

// The story bible lives on disk as a folder of markdown files, one concern per
// file. These are the shared memory between the editor (Opus) and the drafters
// (Sonnet/Haiku): the editor reads them to plan and writes decisions back to
// them so nothing important is ever lost to chat scrollback.
//
//   data/<projectId>/bible/
//     canon.md        - hard facts + author rulings (the decision log)
//     plot.md         - structure, beats, open loops, payoffs
//     style.md        - POV, tense, prose rules, dialogue conventions, do/don'ts
//     timeline.md     - chronology
//     world.md        - settings, lore, rules
//     characters/<slug>.md
//
// Every file opens with a one-line summary (that is the index the editor sees
// without loading full contents).

function projectDir(projectId: string): string {
  return path.join(process.cwd(), "data", projectId);
}
export function bibleDir(projectId: string): string {
  return path.join(projectDir(projectId), "bible");
}

// Resolve a bible-relative path safely, rejecting anything that escapes the
// bible directory (path traversal, absolute paths, symlink tricks).
function resolveInBible(projectId: string, relPath: string): string {
  const root = bibleDir(projectId);
  const resolved = path.resolve(root, relPath);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error(`Path escapes bible directory: ${relPath}`);
  }
  if (!resolved.endsWith(".md")) {
    throw new Error(`Bible files must be .md: ${relPath}`);
  }
  return resolved;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unnamed"
  );
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readBibleFile(
  projectId: string,
  relPath: string
): Promise<string> {
  const resolved = resolveInBible(projectId, relPath);
  if (!(await fileExists(resolved))) return "";
  return fs.readFile(resolved, "utf8");
}

export async function writeBibleFile(
  projectId: string,
  relPath: string,
  content: string
): Promise<void> {
  const resolved = resolveInBible(projectId, relPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, "utf8");
}

export async function appendCanon(
  projectId: string,
  note: string
): Promise<void> {
  const rel = "canon.md";
  const existing = await readBibleFile(projectId, rel);
  const stamp = new Date().toISOString().slice(0, 10);
  const line = `- (${stamp}) ${note.trim()}`;
  const next = existing.trim()
    ? `${existing.trimEnd()}\n${line}\n`
    : `# Canon\n> Hard facts and author rulings the story must never contradict.\n\n${line}\n`;
  await writeBibleFile(projectId, rel, next);
}

export type BibleEntry = { path: string; summary: string };

// List every bible file with its first non-empty line as a summary. This is the
// cheap index the editor sees; it reads full files on demand.
export async function listBible(projectId: string): Promise<BibleEntry[]> {
  const root = bibleDir(projectId);
  const out: BibleEntry[] = [];

  async function walk(dir: string, prefix: string) {
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(path.join(dir, e.name), rel);
      } else if (e.name.endsWith(".md")) {
        const content = await fs.readFile(path.join(dir, e.name), "utf8");
        const summary =
          content
            .split("\n")
            .map((l) => l.replace(/^#+\s*/, "").replace(/^>\s*/, "").trim())
            .find((l) => l.length > 0) || "(empty)";
        out.push({ path: rel, summary: summary.slice(0, 140) });
      }
    }
  }

  await walk(root, "");
  return out;
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

// Create the bible folder and seed it from the project's existing DB records the
// first time. After this, the files are the source of truth.
export async function ensureBible(projectId: string): Promise<void> {
  const root = bibleDir(projectId);
  if (await fileExists(root)) return;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      characters: { orderBy: { name: "asc" } },
      plotPoints: { orderBy: { order: "asc" } },
    },
  });
  if (!project) return;

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

  await fs.mkdir(path.join(root, "characters"), { recursive: true });
  for (const [name, make] of Object.entries(STARTERS)) {
    await writeBibleFile(projectId, name, make(seed));
  }
  for (const c of seed.characters) {
    await writeBibleFile(projectId, `characters/${slugify(c.name)}.md`, characterFile(c));
  }
}
