import { ciciro, queryClient, queryKeys } from "./api";
import type { SearchMatch, SearchOptions, SearchResult } from "./api/types";

export type { SearchMatch, SearchOptions, SearchResult };

export class SearchUnsyncedError extends Error {
  constructor() {
    super("Edits are still waiting to sync");
    this.name = "SearchUnsyncedError";
  }
}

export type MatchGroup = { chapterId: string; title: string; number: number; matches: SearchMatch[] };

/** Matches arrive in manuscript order; group the runs that share a chapter. */
export function groupMatches(matches: SearchMatch[]): MatchGroup[] {
  const groups: MatchGroup[] = [];
  for (const match of matches) {
    const last = groups[groups.length - 1];
    if (last && last.chapterId === match.chapterId) last.matches.push(match);
    else {
      groups.push({
        chapterId: match.chapterId,
        title: match.chapterTitle,
        number: match.chapterNumber,
        matches: [match],
      });
    }
  }
  return groups;
}

export function matchKey(match: SearchMatch): string {
  return `${match.chapterId}:${match.blockId}:${match.occurrence}`;
}

/**
 * Replace one match, or every match when `target` is omitted. `flush` pushes
 * edits still queued in the local replica first, so the server rewrites the
 * text the author actually sees; it resolves false when some could not be sent.
 * The rewrite is an ordinary chapter write, so the replica picks it up on its
 * next sync like any change made on another device.
 */
export async function replaceInManuscript(
  projectId: string,
  query: string,
  replacement: string,
  options: SearchOptions,
  opts?: { target?: SearchMatch; flush?: () => Promise<boolean> }
): Promise<number> {
  if (opts?.flush && !(await opts.flush())) throw new SearchUnsyncedError();
  const target = opts?.target;
  const result = await ciciro.search.replace(projectId, {
    query,
    replacement,
    ...options,
    ...(target
      ? { target: { chapterId: target.chapterId, blockId: target.blockId, occurrence: target.occurrence } }
      : {}),
  });
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.chapters.list(projectId) });
  return result.replaced;
}
