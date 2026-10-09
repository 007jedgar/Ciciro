import { useEffect, useState } from "react";
import { lookupSynonyms } from "./synonyms-lookup";
import { synonymCacheKey, type SynonymContext } from "./selection-menu";

export type Synonyms =
  | { status: "idle" | "loading" | "none"; list: [] }
  | { status: "ready"; list: string[] };

const IDLE: Synonyms = { status: "idle", list: [] };

/**
 * Synonyms for the word in `context`, looked up when it changes. Null asks for
 * nothing. A failed or empty lookup is `none` (offline, over the allowance,
 * nothing fits): the menu just leaves the chips out.
 */
export function useSynonyms(context: SynonymContext | null): Synonyms {
  const key = context ? synonymCacheKey(context) : null;
  const [result, setResult] = useState<{ key: string; synonyms: Synonyms } | null>(null);

  useEffect(() => {
    if (!context || !key) return;
    let current = true;
    lookupSynonyms(context).then(
      (list) => {
        if (current) setResult({ key, synonyms: list.length > 0 ? { status: "ready", list } : { status: "none", list: [] } });
      },
      () => {
        if (current) setResult({ key, synonyms: { status: "none", list: [] } });
      }
    );
    return () => {
      current = false;
    };
    // The key stands for the whole context.
  }, [key]);

  if (!key) return IDLE;
  return result?.key === key ? result.synonyms : { status: "loading", list: [] };
}
