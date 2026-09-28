import type { ManuscriptRepetitionReport } from "@/lib/repetition";

export type {
  ChapterRepetitionReport,
  ManuscriptRepetitionReport,
  RepetitionFlag,
  RepetitionReport,
} from "@/lib/repetition";

export async function fetchRepetitionReport(
  projectId: string,
  signal?: AbortSignal
): Promise<ManuscriptRepetitionReport> {
  const res = await fetch(`/api/projects/${projectId}/repetition`, { cache: "no-store", signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || "Couldn't check for repetition.");
  }
  return (await res.json()) as ManuscriptRepetitionReport;
}
