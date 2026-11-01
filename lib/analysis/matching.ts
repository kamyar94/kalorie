// Matching (docs/DESIGN.md section 4 step 3): each analysed item, and each component of a mixed
// dish, gets a database food or none.
//   1. a barcode read from a package that is in the person's visible foods: that food;
//   2. a remembered correction (food_memory) for the same name: that food;
//   3. otherwise candidates from the food search contract (searchFoods) for the item's search
//      terms, the remembered food first, at most eight; then ONE text-only call for the task
//      "matching" picks a candidate id or none per entry;
//   4. when that call fails (no key, provider error, bad reply) or skips an entry, the best
//      trigram score of the candidates' names, if it reaches MATCH_THRESHOLD.
import { and, eq, isNull, or } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { foods } from "@/db/schema";
import { isAiError } from "@/lib/ai/errors";
import { runAiTask } from "@/lib/ai/service";
import type { FoodResult } from "@/lib/contracts/food-search";
import { getFood, getFoodsByIds, searchFoods } from "@/lib/food/search";
import { normalizeFoodText } from "@/lib/food/normalize";

import { buildMatchingPrompt, MATCHING_SYSTEM, type MatchingEntry } from "./prompt";
import { MATCHING_SCHEMA } from "./schema";
import { matchScore, withoutGenericMarkers } from "./trigram";

export const MAX_CANDIDATES = 8;
/** Lowest trigram score the fallback accepts (lib/analysis/trigram.ts matchScore). */
export const MATCH_THRESHOLD = 0.5;
/** Search phrases tried per entry. */
const MAX_QUERIES = 3;

export type MatchSubject = {
  /** Unique within one matching run, for example "item:0" or "item:0:c:1". */
  key: string;
  name: string;
  localName: string | null;
  kind: string;
  preparation: string | null;
  grams: number;
  searchTerms: string[];
  /** "Ghormeh sabzi" when this subject is a component of that dish. */
  partOf: string | null;
  /** Barcode digits read from a package. */
  barcode: string | null;
  /** A food the person corrected this name to before (food_memory). */
  memoryFoodId: string | null;
};

export type MatchMethod = "barcode" | "memory" | "ai" | "trigram" | "none";

export type MatchResult = {
  food: FoodResult | null;
  method: MatchMethod;
  /** The candidates that were considered, best first (for diagnostics and tests). */
  candidates: FoodResult[];
};

export type MatchOptions = {
  /** false: skip the AI call and use the trigram fallback only. */
  useAi?: boolean;
  mealId?: string;
  signal?: AbortSignal;
  log?: (message: string) => void;
  db?: DbOrTx;
};

const queriesFor = (subject: MatchSubject) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of [subject.name, ...subject.searchTerms, subject.localName ?? ""]) {
    const key = normalizeFoodText(term);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= MAX_QUERIES) break;
  }
  return out;
};

/**
 * Best trigram score of a food's names for the subject's names and search terms. FoodData
 * Central's not-specified markers ("NFS", "no added fat") are left out of the English name.
 */
export const subjectScore = (subject: MatchSubject, food: FoodResult) => {
  const queries = [subject.name, subject.localName ?? "", ...subject.searchTerms].filter(Boolean);
  const names = [withoutGenericMarkers(food.nameEn), food.nameFa ?? ""].filter(Boolean);
  let best = 0;
  for (const q of queries) for (const n of names) best = Math.max(best, matchScore(q, n));
  return best;
};

/**
 * Candidates with their trigram scores, best first: the remembered food, then the trigram score
 * (to two decimals, so near ties count as ties), then the person's own, then the food search's
 * own score (which prefers plain forms such as "raw" and "NFS"), then the name.
 */
const scored = (subject: MatchSubject, candidates: FoodResult[]) =>
  candidates
    .map((food) => ({ food, score: subjectScore(subject, food) }))
    .sort(
      (a, b) =>
        Number(b.food.id === subject.memoryFoodId) - Number(a.food.id === subject.memoryFoodId) ||
        Math.round(b.score * 100) - Math.round(a.score * 100) ||
        Number(b.food.personal) - Number(a.food.personal) ||
        b.food.score - a.food.score ||
        a.food.nameEn.localeCompare(b.food.nameEn),
    );

/** Ranks candidates (see scored) and keeps at most eight. */
export const rankCandidates = (subject: MatchSubject, candidates: FoodResult[]) =>
  scored(subject, candidates)
    .map((entry) => entry.food)
    .slice(0, MAX_CANDIDATES);

/** The deterministic choice: the remembered food, or the best score at or above the threshold. */
export const chooseByTrigram = (subject: MatchSubject, candidates: FoodResult[]) => {
  const remembered = candidates.find((c) => c.id === subject.memoryFoodId);
  if (remembered) return remembered;
  const best = scored(subject, candidates)[0];
  return best && best.score >= MATCH_THRESHOLD ? best.food : null;
};

/** A food with this barcode the person can see (their own first). */
export const findByBarcode = async (userId: string, barcode: string, dbx: DbOrTx = defaultDb) => {
  const rows = await dbx
    .select({ id: foods.id, ownerId: foods.ownerId })
    .from(foods)
    .where(and(eq(foods.barcode, barcode), or(isNull(foods.ownerId), eq(foods.ownerId, userId))))
    .limit(5);
  const own = rows.find((r) => r.ownerId === userId) ?? rows[0];
  return own ? getFood(own.id, userId, dbx) : null;
};

export const gatherCandidates = async (userId: string, subject: MatchSubject, dbx: DbOrTx) => {
  const byId = new Map<string, FoodResult>();
  if (subject.memoryFoodId) {
    const remembered = await getFood(subject.memoryFoodId, userId, dbx);
    if (remembered) byId.set(remembered.id, remembered);
  }
  for (const query of queriesFor(subject)) {
    for (const food of await searchFoods({ query, userId, limit: MAX_CANDIDATES }, dbx))
      if (!byId.has(food.id)) byId.set(food.id, food);
  }
  return rankCandidates(subject, [...byId.values()]);
};

/**
 * One text-only call for all entries. Returns the chosen food id (or null for none) per subject
 * key; entries the reply skipped or answered with an unknown id are left out.
 */
export const chooseWithAi = async (
  userId: string,
  pending: { subject: MatchSubject; candidates: FoodResult[] }[],
  options: MatchOptions = {},
): Promise<Map<string, string | null>> => {
  const refs = new Map<string, string>(); // food id -> c1...
  const byRef = new Map<string, string>(); // c1 -> food id
  const entries: MatchingEntry[] = pending.map(({ subject, candidates }, index) => ({
    number: index + 1,
    name: subject.name,
    localName: subject.localName,
    kind: subject.kind,
    preparation: subject.preparation,
    grams: subject.grams,
    partOf: subject.partOf,
    candidates: candidates.map((food) => {
      let ref = refs.get(food.id);
      if (!ref) {
        ref = `c${refs.size + 1}`;
        refs.set(food.id, ref);
        byRef.set(ref, food.id);
      }
      return {
        ref,
        name: food.nameEn,
        nameFa: food.nameFa,
        kind: food.kind,
        brand: food.brand,
        category: food.category,
        kcalPer100g: typeof food.per100g.energy === "number" ? food.per100g.energy : null,
        personal: food.personal,
      };
    }),
  }));

  const response = await runAiTask(
    userId,
    "matching",
    {
      system: MATCHING_SYSTEM,
      prompt: buildMatchingPrompt(entries),
      json: { name: "food_matches", schema: MATCHING_SCHEMA },
      maxOutputTokens: 4096,
      signal: options.signal,
    },
    { mealId: options.mealId, db: options.db },
  );

  const chosen = new Map<string, string | null>();
  const matches = (response.json as { matches?: unknown } | undefined)?.matches;
  for (const match of Array.isArray(matches) ? matches : []) {
    const m = match as { entry?: unknown; candidate?: unknown };
    const entry = typeof m.entry === "number" ? pending[m.entry - 1] : undefined;
    if (!entry || chosen.has(entry.subject.key)) continue;
    const answer = typeof m.candidate === "string" ? m.candidate.trim().toLowerCase() : "";
    if (answer === "none") {
      chosen.set(entry.subject.key, null);
      continue;
    }
    const foodId = byRef.get(answer);
    if (foodId && entry.candidates.some((c) => c.id === foodId))
      chosen.set(entry.subject.key, foodId);
  }
  return chosen;
};

/** Matches every subject. Never throws for AI problems: it falls back to trigram scores. */
export const matchSubjects = async (
  userId: string,
  subjects: MatchSubject[],
  options: MatchOptions = {},
): Promise<Map<string, MatchResult>> => {
  const dbx = options.db ?? defaultDb;
  const results = new Map<string, MatchResult>();
  const pending: { subject: MatchSubject; candidates: FoodResult[] }[] = [];

  for (const subject of subjects) {
    if (subject.barcode) {
      const food = await findByBarcode(userId, subject.barcode, dbx);
      if (food) {
        results.set(subject.key, { food, method: "barcode", candidates: [food] });
        continue;
      }
    }
    if (subject.memoryFoodId) {
      const food = (await getFoodsByIds([subject.memoryFoodId], userId, dbx)).get(
        subject.memoryFoodId,
      );
      if (food) {
        results.set(subject.key, { food, method: "memory", candidates: [food] });
        continue;
      }
    }
    const candidates = await gatherCandidates(userId, subject, dbx);
    if (!candidates.length) results.set(subject.key, { food: null, method: "none", candidates });
    else pending.push({ subject, candidates });
  }
  if (!pending.length) return results;

  let chosen = new Map<string, string | null>();
  if (options.useAi !== false) {
    try {
      chosen = await chooseWithAi(userId, pending, options);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      options.log?.(
        `matching call failed (${isAiError(error) ? error.kind : "error"}); using trigram scores`,
      );
    }
  }

  for (const { subject, candidates } of pending) {
    if (chosen.has(subject.key)) {
      const id = chosen.get(subject.key);
      results.set(subject.key, {
        food: id ? (candidates.find((c) => c.id === id) ?? null) : null,
        method: id ? "ai" : "none",
        candidates,
      });
      continue;
    }
    const food = chooseByTrigram(subject, candidates);
    results.set(subject.key, { food, method: food ? "trigram" : "none", candidates });
  }
  return results;
};
