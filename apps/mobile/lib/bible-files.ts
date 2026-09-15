import type { BibleEntry } from "./api/types";

export const CORE_BIBLE_PATHS = [
  "canon.md",
  "plot.md",
  "style.md",
  "timeline.md",
  "world.md",
] as const;

export type BibleFileGroup = "core" | "characters" | "plotLines" | "other";

export type GroupedBibleEntries = {
  core: BibleEntry[];
  characters: BibleEntry[];
  plotLines: BibleEntry[];
  other: BibleEntry[];
};

/** Title shown in the list: "Canon", "Ada Lovelace", "The heist". */
export function bibleFileLabel(path: string): string {
  const base = path.replace(/\.md$/i, "");
  const leaf = base.includes("/") ? base.slice(base.lastIndexOf("/") + 1) : base;
  return leaf
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function bibleFileGroup(path: string): BibleFileGroup {
  if ((CORE_BIBLE_PATHS as readonly string[]).includes(path)) return "core";
  if (path.startsWith("characters/") && path.endsWith(".md")) return "characters";
  if (path.startsWith("plot/") && path.endsWith(".md")) return "plotLines";
  return "other";
}

/** Always surface the five starter files, even before the server has listed them. */
export function withCoreBibleFiles(
  entries: BibleEntry[],
  emptySummary: string
): BibleEntry[] {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const core = CORE_BIBLE_PATHS.map(
    (path) => byPath.get(path) ?? { path, summary: emptySummary }
  );
  const rest = entries.filter((entry) => !(CORE_BIBLE_PATHS as readonly string[]).includes(entry.path));
  return [...core, ...rest];
}

export function groupBibleEntries(entries: BibleEntry[]): GroupedBibleEntries {
  const grouped: GroupedBibleEntries = {
    core: [],
    characters: [],
    plotLines: [],
    other: [],
  };
  for (const entry of entries) {
    grouped[bibleFileGroup(entry.path)].push(entry);
  }
  return grouped;
}

export function biblePathFromParam(path: string | string[] | undefined): string {
  if (!path) return "";
  const parts = Array.isArray(path) ? path : [path];
  return parts.map((part) => decodeURIComponent(part)).join("/");
}

export function bibleFileHref(projectId: string, path: string): string {
  const encoded = path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `/project/${projectId}/bible/${encoded}`;
}

export function bibleIndexHref(projectId: string): string {
  return `/project/${projectId}/bible`;
}
