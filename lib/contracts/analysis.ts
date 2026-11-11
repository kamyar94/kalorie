// CONTRACT: the analysis job (docs/DESIGN.md section 4). The upload route enqueues an
// "analyze-meal" job; the worker runs the handler registered for it (worker/handlers.ts ->
// lib/analysis/handler.ts).
//
// The payload is small on purpose: everything the analysis reads (photos, note, answers to
// questions, corrections typed by the person) lives on the meal row, so a job always works on the
// latest state and a queued job can stand in for a newer request (dedupe per meal).
//
// What the screens call (server functions in lib/analysis/requests.ts, each scoped by user id,
// each returning AnalysisRequestResult; the same as HTTP routes):
//   answerQuestion(userId, mealId, questionId, answer)    POST /api/meals/:id/answers {questionId, answer}
//   correctMeal(userId, mealId, text, {replaceEdits})     POST /api/meals/:id/corrections {text, replaceEdits?}
//   retryAnalysis(userId, mealId, {replaceEdits})         POST /api/meals/:id/retry   {replaceEdits?}
// Each one stores the input on the meal, sets it "queued" and enqueues an analysis.
import type { MealDto, MealSlot, MealStatus } from "./meals";
import type { NutrientEstimate, NutrientMap } from "./nutrients";

export const ANALYZE_MEAL_JOB = "analyze-meal";

export type AnalyzeMealReason = "upload" | "answer" | "correction" | "retry";

export type AnalyzeMealPayload = {
  mealId: string;
  userId: string;
  reason: AnalyzeMealReason;
  /** Replace the person's manual edits instead of keeping them. Default false. */
  replaceEdits?: boolean;
};

export const isAnalyzeMealPayload = (value: unknown): value is AnalyzeMealPayload => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.mealId === "string" &&
    typeof v.userId === "string" &&
    ["upload", "answer", "correction", "retry"].includes(v.reason as string) &&
    (v.replaceEdits === undefined || typeof v.replaceEdits === "boolean")
  );
};

/** What the handler returns (stored as the job result). */
export type AnalyzeMealResult = {
  mealId: string;
  status: MealStatus;
  items: number;
  questions: number;
  /** Set when the meal ended in "failed": an AiErrorKind or "not-food". */
  errorKind?: string;
};

// ---- The vision model's output (stored in meals.analysis) ----
// Field names follow the JSON schema sent to the model (snake_case), section 4 step 2.

export type AnalysisQuestion = {
  question: string;
  /** Two to four suggested answers. */
  answers: string[];
};

export type AnalysisLabel = {
  /** Barcode digits read from a visible package. */
  barcode: string | null;
  /** Nutrition facts read from a label, per 100 g when the label says so. */
  per100g: NutrientEstimate | null;
  perServing: NutrientEstimate | null;
  servingGrams: number | null;
};

export type AnalysisItem = {
  name: string;
  /** The name in the cuisine's own language, for example Persian. */
  local_name: string | null;
  kind: "dish" | "ingredient" | "drink" | "packaged";
  /** One emoji for the food, null when the model gave none (or not exactly one). */
  emoji: string | null;
  preparation: string | null;
  grams: number | null;
  ml: number | null;
  grams_low: number | null;
  grams_high: number | null;
  portion_text: string | null;
  confidence: number;
  photo_indexes: number[];
  search_terms: string[];
  /** Id of a usual meal (food_memory) this item matches. */
  matches_usual: string | null;
  /** Mealie recipe id of today's plan this item matches. */
  matches_planned: string | null;
  components: { name: string; grams: number }[];
  label: AnalysisLabel | null;
  /** Last-resort nutrients for the whole item (sodium in mg). */
  estimate: NutrientEstimate;
};

/**
 * What a photo (or a description) that is not food shows, as far as the analysis can tell: a
 * medicine or a supplement (the meal can then be logged as a medicine), or something else.
 */
export const NOT_FOOD_KINDS = ["medicine", "supplement", "other"] as const;
export type NotFoodKind = (typeof NOT_FOOD_KINDS)[number];

export const isNotFoodKind = (value: unknown): value is NotFoodKind =>
  typeof value === "string" && (NOT_FOOD_KINDS as readonly string[]).includes(value);

export type AnalysisOutput = {
  is_food: boolean;
  /**
   * When it is not food: what it is (null for food). Analyses from before this field have none;
   * lib/analysis/not-food.ts then reads the stored words.
   */
  not_food_kind?: NotFoodKind | null;
  title: string;
  /**
   * The model's name for the meal (a slot), judged from the food, the amount and the local time;
   * null when it gave none. lib/meals/classify.ts decides with it.
   */
  meal_type: MealSlot | null;
  cuisine: string | null;
  overall_confidence: number;
  /** At most two short clarifying questions. */
  questions: AnalysisQuestion[];
  items: AnalysisItem[];
};

// ---- Requests from the screens ----

export type AnalysisRequestResult =
  { ok: true; meal: MealDto } | { ok: false; status: 400 | 404 | 409 | 429; error: string };

/** Longest answer or correction the person can send. */
export const ANALYSIS_INPUT_LIMITS = { answerChars: 200, correctionChars: 500 } as const;

// ---- Context from the integrations (Mealie) ----

/**
 * A recipe planned for the meal's day in Mealie (docs/DESIGN.md section 8). The analysis puts the
 * names into the photo context, so a photo of tonight's planned dinner links to its recipe, and
 * uses the nutrition per serving for a linked item. Provided through
 * setPlannedRecipesSource in lib/analysis/planned.ts (empty until Mealie is connected).
 */
export type PlannedRecipe = {
  /** Mealie recipe id (stored in AnalysisItem.matches_planned). */
  id: string;
  name: string;
  /** The planned slot, when the plan says. */
  slot: MealSlot | null;
  /** The food row of the recipe in Kal (source "mealie"), when there is one. */
  foodId: string | null;
  /** Grams of one serving, when known. */
  servingGrams: number | null;
  /** Nutrients of one serving; null when Mealie has none and Kal did not compute them. */
  nutritionPerServing: NutrientMap | null;
};

export type PlannedRecipesSource = (userId: string, localDate: string) => Promise<PlannedRecipe[]>;

/**
 * Told once per finished analysis run (ready, needs_input or failed; not while it waits for a
 * retry), for the "analysis ready" and "a question about your meal" push notifications. Registered
 * with setAnalysisFinishedListener in lib/analysis/events.ts.
 */
export type AnalysisFinishedEvent = {
  userId: string;
  mealId: string;
  status: MealStatus;
  /** Open questions after the run. */
  questions: number;
  errorKind: string | null;
};

export type AnalysisFinishedListener = (event: AnalysisFinishedEvent) => void | Promise<void>;
