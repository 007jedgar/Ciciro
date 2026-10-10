import { prisma } from "@/lib/db";
import { visibleChapterWhere } from "@/lib/chapters";
import { normalizeKind } from "@/lib/manuscript-kind";
import { estimatePages, scriptBlocksFromHtml } from "@/lib/screenplay";

// How many pages a screenplay runs, for the manuscript lists. The count is
// derived from the script itself (the same layout the editor and the phone's
// page view use), never stored, so it is read here for the screenplays in a
// list and for no other kind.

/** Ids per query: D1 binds at most 100 parameters to one statement. */
const CHUNK = 50;

/** About how many pages each screenplay among `projects` runs, by project id. Empty scripts are left out. */
export async function scriptPageCounts(
  projects: readonly { id: string; kind?: string | null }[]
): Promise<Map<string, number>> {
  const ids = projects.filter((p) => normalizeKind(p.kind) === "screenplay").map((p) => p.id);
  const counts = new Map<string, number>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await prisma.chapter.findMany({
      where: { projectId: { in: ids.slice(i, i + CHUNK) }, ...visibleChapterWhere },
      orderBy: [{ projectId: "asc" }, { order: "asc" }],
      select: { projectId: true, content: true },
    });
    const byProject = new Map<string, string[]>();
    for (const row of rows) byProject.set(row.projectId, [...(byProject.get(row.projectId) ?? []), row.content]);
    for (const [projectId, chapters] of byProject) {
      // A script with nothing typed yet (the opening scene heading) has no pages to speak of.
      if (!chapters.some((html) => scriptBlocksFromHtml(html).some((b) => b.text.trim()))) continue;
      const pages = estimatePages(chapters);
      if (pages > 0) counts.set(projectId, pages);
    }
  }
  return counts;
}

/** `projects`, each screenplay carrying its `pages`. Other kinds come back as they were. */
export async function withScriptPages<T extends { id: string; kind?: string | null }>(
  projects: readonly T[]
): Promise<(T & { pages?: number })[]> {
  const counts = await scriptPageCounts(projects);
  return projects.map((p) => (counts.has(p.id) ? { ...p, pages: counts.get(p.id) } : p));
}
