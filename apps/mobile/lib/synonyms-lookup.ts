import { ciciro } from "./api";
import { createSynonymLookup } from "./selection-menu";

/**
 * Synonyms for a word in its sentence. The last words looked up come straight
 * back, so selecting the same word again costs no request.
 */
export const lookupSynonyms = createSynonymLookup(async (context) => {
  const result = await ciciro.synonyms.post(context);
  return result.synonyms;
});
