import type { ReplacedChapter, SearchMatch, SearchResult } from "@/lib/project-search";

export type { ReplacedChapter, SearchMatch, SearchResult };

export type SearchQuery = { query: string; matchCase: boolean; wholeWord: boolean };

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error || fallback);
}

export async function searchManuscript(
  projectId: string,
  q: SearchQuery,
  signal?: AbortSignal
): Promise<SearchResult> {
  const params = new URLSearchParams({ q: q.query });
  if (q.matchCase) params.set("matchCase", "1");
  if (q.wholeWord) params.set("wholeWord", "1");
  const res = await fetch(`/api/projects/${projectId}/search?${params}`, {
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw await failure(res, "Search failed.");
  return (await res.json()) as SearchResult;
}

export async function replaceInManuscript(
  projectId: string,
  q: SearchQuery,
  replacement: string,
  target?: { chapterId: string; blockId: string; occurrence: number }
): Promise<{ replaced: number; chapters: ReplacedChapter[] }> {
  const res = await fetch(`/api/projects/${projectId}/replace`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...q, replacement, target }),
  });
  if (!res.ok) throw await failure(res, "Replace failed.");
  return (await res.json()) as { replaced: number; chapters: ReplacedChapter[] };
}
