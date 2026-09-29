import type { StyleAnalysisProposal } from "@/lib/style-analysis-view";
import { reportAiLimit } from "@/lib/billing-client";

export type {
  CharacterVoiceProposal,
  StyleAnalysisProposal,
  StyleTrait,
  StyleTraitCategory,
} from "@/lib/style-analysis-view";

export async function runStyleAnalysis(
  projectId: string,
  signal?: AbortSignal
): Promise<StyleAnalysisProposal> {
  const res = await fetch(`/api/projects/${projectId}/style-analysis`, {
    method: "POST",
    cache: "no-store",
    signal,
  });
  const body = (await res.json().catch(() => null)) as
    | (StyleAnalysisProposal & { error?: string })
    | { error?: string }
    | null;
  if (!res.ok) {
    reportAiLimit(res.status, body);
    throw new Error(body?.error || "Couldn't analyze style.");
  }
  return body as StyleAnalysisProposal;
}

/** Save one accepted piece of the proposal through the existing bible write path. */
export async function saveBibleFile(
  projectId: string,
  path: string,
  content: string,
  expectedRevision?: number
): Promise<{ revision: number }> {
  const res = await fetch("/api/bible", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, path, content, expectedRevision }),
  });
  const data = (await res.json().catch(() => null)) as { revision?: number; error?: string } | null;
  if (!res.ok || typeof data?.revision !== "number") {
    throw new Error(data?.error || "Couldn't save that to the bible.");
  }
  return { revision: data.revision };
}
