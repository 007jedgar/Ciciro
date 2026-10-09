import { createSynonymLookup, type SynonymContext } from "./selection-menu";

/**
 * Synonyms for a word in its sentence from /api/synonyms, remembered for the
 * session. Rejects when the request fails; an answer with no synonyms (offline
 * is a failure, but an allowance that is used up is just an empty list) is [].
 */
export const lookupSynonyms: (context: SynonymContext) => Promise<string[]> = createSynonymLookup(
  async (context) => {
    const res = await fetch("/api/synonyms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(context),
    });
    if (!res.ok) throw new Error(`Synonyms failed (${res.status}).`);
    const data = (await res.json()) as { synonyms?: unknown };
    return Array.isArray(data.synonyms)
      ? data.synonyms.filter((item): item is string => typeof item === "string")
      : [];
  }
);
