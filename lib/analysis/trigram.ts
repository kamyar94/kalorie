// Trigram similarity in the style of Postgres pg_trgm, for the deterministic matching fallback.
// Text is normalised like foods.search_text (lib/food/normalize.ts); each word is padded with two
// spaces in front and one behind, so short words and word starts count. Pure code.
import { normalizeFoodText } from "@/lib/food/normalize";

export const trigrams = (value: string) => {
  const set = new Set<string>();
  for (const word of normalizeFoodText(value).split(" ")) {
    if (!word) continue;
    const chars = Array.from(`  ${word} `);
    for (let i = 0; i + 3 <= chars.length; i += 1) set.add(chars.slice(i, i + 3).join(""));
  }
  return set;
};

const overlap = (a: Set<string>, b: Set<string>) => {
  let common = 0;
  for (const t of a) if (b.has(t)) common += 1;
  return common;
};

/** pg_trgm similarity: shared trigrams over all trigrams of both texts, 0 to 1. */
export const trigramSimilarity = (a: string, b: string) => {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (!ta.size || !tb.size) return 0;
  const common = overlap(ta, tb);
  return common / (ta.size + tb.size - common);
};

/** Share of the query's trigrams found in the text, 0 to 1 (long database names score well). */
export const trigramContainment = (query: string, value: string) => {
  const tq = trigrams(query);
  if (!tq.size) return 0;
  return overlap(tq, trigrams(value)) / tq.size;
};

/**
 * The fallback's score of a database name for a query: mostly how much of the query the name
 * contains, a little how close the two are overall (so "rice" prefers "Rice, cooked" over
 * "Rice pudding with raisins and cream").
 */
export const matchScore = (query: string, name: string) =>
  0.6 * trigramContainment(query, name) + 0.4 * trigramSimilarity(query, name);

/** FoodData Central's not-specified markers: "NFS", "NS as to ..." (to the next comma), "no added fat". */
const GENERIC_MARKERS = /\b(?:nfs|ns as to [^,()]*|no added fat)\b/gi;

/**
 * A database name without its not-specified markers, for scoring: "Rice, white, cooked, no added
 * fat" is plain cooked white rice and should not lose to "Rice, white, cooked, glutinous" only
 * because the marker words are longer. A name that is nothing but markers stays as it is.
 */
export const withoutGenericMarkers = (name: string) => {
  const stripped = name.replace(GENERIC_MARKERS, " ");
  return normalizeFoodText(stripped) ? stripped : name;
};
