// Reads the analysis model's JSON into the contract's AnalysisOutput: every value checked and
// clamped, "nothing" (empty strings, zeros, empty arrays) turned into null, the short ids of the
// prompt (u3, p1, i2) turned back into real ids, and impossible amounts repaired. A reply that is
// not the expected shape at all is an AiError of kind "invalid-output" (the job may retry it).
// Pure code, no database.
import { AiError } from "@/lib/ai/errors";
import type { AiProvider, AiUsage } from "@/lib/ai/types";
import {
  isNotFoodKind,
  type AnalysisItem,
  type AnalysisLabel,
  type AnalysisOutput,
  type AnalysisQuestion,
} from "@/lib/contracts/analysis";
import { isMealSlot } from "@/lib/contracts/meals";
import type { NutrientEstimate } from "@/lib/contracts/nutrients";
import { cleanEmoji } from "@/lib/food/emoji";

import { notFoodKindFromWords } from "./not-food";

import {
  ANALYSIS_ITEM_KINDS,
  LABEL_BASES,
  LABEL_NUTRIENTS,
  type LabelBasis,
  type LabelNutrient,
} from "./schema";

export const PARSE_LIMITS = {
  items: 20,
  components: 12,
  questions: 2,
  answers: 4,
  searchTerms: 5,
  /** Largest weight or volume of one item. */
  maxAmount: 5000,
} as const;

/** The short ids the prompt used, mapped to real ids. */
export type PromptRefs = {
  photoCount: number;
  /** "u12" -> food_memory id "12". */
  usual: Map<string, string>;
  /** "p1" -> Mealie recipe id. */
  planned: Map<string, string>;
  /** "i1" -> meal_items id (re-analysis). */
  current: Map<string, string>;
};

export type ParsedAnalysis = {
  output: AnalysisOutput;
  /** Per output item: the current item (meal_items id) it is the same as, or null. */
  sameAs: (string | null)[];
};

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

const orNull = (value: string) => value || null;

const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const positive = (value: unknown, max: number = PARSE_LIMITS.maxAmount) => {
  const n = number(value);
  return n !== null && n > 0 ? Math.min(n, max) : null;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const parseEstimate = (value: unknown): NutrientEstimate => {
  const raw = record(value) ?? {};
  const out: NutrientEstimate = {};
  for (const key of LABEL_NUTRIENTS) {
    const n = number(raw[key]);
    out[key] = n !== null && n >= 0 ? round1(Math.min(n, key === "kcal" ? 20_000 : 50_000)) : null;
  }
  return out;
};

const emptyEstimate = (estimate: NutrientEstimate) =>
  Object.values(estimate).every((v) => v === null || v === undefined);

/** Barcodes are 8 to 14 digits; anything else is dropped rather than guessed. */
export const cleanBarcode = (value: unknown) => {
  const digits = typeof value === "string" ? value.replace(/[\s-]/g, "") : "";
  return /^\d{8,14}$/.test(digits) ? digits : null;
};

const parseLabel = (value: unknown): AnalysisLabel | null => {
  const raw = record(array(value)[0]);
  if (!raw) return null;
  const per100g: NutrientEstimate = {};
  const perServing: NutrientEstimate = {};
  for (const fact of array(raw.facts)) {
    const f = record(fact);
    if (!f) continue;
    const nutrient = f.nutrient as LabelNutrient;
    const basis = f.basis as LabelBasis;
    const amount = number(f.amount);
    if (!LABEL_NUTRIENTS.includes(nutrient) || !LABEL_BASES.includes(basis)) continue;
    if (amount === null || amount < 0) continue;
    // Drinks print values per 100 ml; for a drink that is close to per 100 g (density near 1).
    const target = basis === "per_serving" ? perServing : per100g;
    target[nutrient] ??= round1(amount);
  }
  const label: AnalysisLabel = {
    barcode: cleanBarcode(raw.barcode),
    per100g: emptyEstimate(per100g) ? null : per100g,
    perServing: emptyEstimate(perServing) ? null : perServing,
    servingGrams: positive(raw.serving_grams, 2000),
  };
  return label.barcode || label.per100g || label.perServing ? label : null;
};

const parseItem = (
  value: unknown,
  refs: PromptRefs,
): (AnalysisItem & { sameAs: string | null }) | null => {
  const raw = record(value);
  if (!raw) return null;
  const name = text(raw.name, 120);
  if (!name) return null;
  const kind = ANALYSIS_ITEM_KINDS.includes(raw.kind as AnalysisItem["kind"])
    ? (raw.kind as AnalysisItem["kind"])
    : "dish";

  const ml = kind === "drink" ? positive(raw.ml) : null;
  const components = array(raw.components)
    .map((c) => {
      const r = record(c);
      const componentName = text(r?.name, 120);
      const grams = positive(r?.grams);
      return componentName && grams ? { name: componentName, grams: round1(grams) } : null;
    })
    .filter((c): c is { name: string; grams: number } => c !== null)
    .slice(0, PARSE_LIMITS.components);
  const componentGrams = components.reduce((sum, c) => sum + c.grams, 0);

  // The weight: the model's grams; else the drink's volume, the middle of the range, the sum of
  // the components, or one 100 g portion as a last resort.
  let low = positive(raw.grams_low);
  let high = positive(raw.grams_high);
  let grams =
    positive(raw.grams) ??
    ml ??
    (low && high ? (low + high) / 2 : null) ??
    (componentGrams > 0 ? componentGrams : null) ??
    100;
  grams = round1(grams);
  if (low === null || low > grams) low = round1(grams * 0.7);
  if (high === null || high < grams) high = round1(grams * 1.3);

  const searchTerms = [
    ...new Set(
      array(raw.search_terms)
        .map((t) => text(t, 80))
        .filter(Boolean),
    ),
  ].slice(0, PARSE_LIMITS.searchTerms);
  if (!searchTerms.length) searchTerms.push(name);

  const photoIndexes = [
    ...new Set(
      array(raw.photo_indexes).filter(
        (i): i is number =>
          Number.isInteger(i) && (i as number) >= 0 && (i as number) < refs.photoCount,
      ),
    ),
  ].sort((a, b) => a - b);

  const ref = (value: unknown, map: Map<string, string>) => {
    const key = text(value, 40).toLowerCase();
    return key ? (map.get(key) ?? null) : null;
  };

  return {
    name,
    local_name: orNull(text(raw.local_name, 120)),
    kind,
    emoji: cleanEmoji(raw.emoji),
    preparation: orNull(text(raw.preparation, 60)),
    grams,
    ml: ml === null ? null : round1(ml),
    grams_low: low,
    grams_high: high,
    portion_text: orNull(text(raw.portion_text, 60)),
    confidence: clamp(number(raw.confidence) ?? 0.5, 0, 1),
    photo_indexes: photoIndexes,
    search_terms: searchTerms,
    matches_usual: ref(raw.matches_usual, refs.usual),
    matches_planned: ref(raw.matches_planned, refs.planned),
    components,
    label: parseLabel(raw.label),
    estimate: parseEstimate(raw.estimate),
    sameAs: ref(raw.same_as_item, refs.current),
  };
};

const parseQuestion = (value: unknown): AnalysisQuestion | null => {
  const raw = record(value);
  const question = text(raw?.question, 200);
  if (!question) return null;
  const answers = [
    ...new Set(
      array(raw?.answers)
        .map((a) => text(a, 60))
        .filter(Boolean),
    ),
  ].slice(0, PARSE_LIMITS.answers);
  return { question, answers };
};

/**
 * Cleans the analysis reply. Throws AiError("invalid-output") when it is not an object with
 * is_food and an items list.
 */
export const parseAnalysis = (
  value: unknown,
  refs: PromptRefs,
  source: { provider?: AiProvider; usage?: AiUsage } = {},
): ParsedAnalysis => {
  const raw = record(value);
  if (!raw || typeof raw.is_food !== "boolean" || !Array.isArray(raw.items))
    throw new AiError("invalid-output", "The analysis reply did not match the schema.", source);

  const items = raw.items
    .map((item) => parseItem(item, refs))
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, PARSE_LIMITS.items);
  const isFood = raw.is_food && items.length > 0;
  const title = text(raw.title, 80);

  const output: AnalysisOutput = {
    is_food: isFood,
    // Not food: what it is. A reply without a valid kind ("none", or from an older prompt) is
    // judged from its title's words, else "other".
    not_food_kind: isFood
      ? null
      : isNotFoodKind(raw.not_food_kind)
        ? raw.not_food_kind
        : notFoodKindFromWords(title),
    title,
    meal_type: isFood && isMealSlot(raw.meal_type) ? raw.meal_type : null,
    cuisine: orNull(text(raw.cuisine, 40)),
    overall_confidence: clamp(number(raw.overall_confidence) ?? 0.5, 0, 1),
    questions: isFood
      ? array(raw.questions)
          .map(parseQuestion)
          .filter((q): q is AnalysisQuestion => q !== null)
          .slice(0, PARSE_LIMITS.questions)
      : [],
    items: isFood ? items.map(({ sameAs: _sameAs, ...item }) => item) : [],
  };
  return { output, sameAs: isFood ? items.map((item) => item.sameAs) : [] };
};
