// CONTRACT: meal and item DTOs, as the server functions in lib/meals/service.ts and the meal
// routes return them, and as the screens render them. Plain data (dates as ISO strings), safe to
// import from client components.
//
// Server functions (lib/meals/service.ts), every one scoped by the signed-in user's id:
//   listMealsForDay(userId, localDate)            -> MealSummaryDto[]
//   getMeal(userId, mealId)                       -> MealDto | null
//   updateMeal(userId, mealId, MealPatch)         -> MealDto | null
//   deleteMeal(userId, mealId)                    -> boolean     (soft delete)
//   duplicateMeal(userId, mealId, {eatenAt, tz})  -> MealDto | null
//   addItem(userId, mealId, ItemInput)            -> MealItemDto | null
//   updateItem(userId, itemId, ItemPatch)         -> MealItemDto | null
//   deleteItem(userId, itemId)                    -> boolean
//   recomputeMealTotals(mealId)                   -> NutrientMap
// Creating a photo meal is lib/meals/create.ts (createPhotoMeal), used by POST /api/meals.
import type { NutrientMap } from "./nutrients";

export const MEAL_STATUSES = ["queued", "analysing", "needs_input", "ready", "failed"] as const;
/**
 * queued: waiting for the analysis worker (a new upload, an answer or a correction, or a retry
 * after a provider error, when error says why); analysing: the worker is on it now; needs_input:
 * open questions (items and totals are already there); ready: done; failed: see error.
 * Screens treat queued like analysing (a spinner).
 */
export type MealStatus = (typeof MEAL_STATUSES)[number];

/** States only the device knows, before the server has the meal. */
export type LocalMealState = "waiting" | "uploading";

export const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export type MealSource = "photo" | "manual" | "mealie" | "duplicate";

export type ItemKind = "dish" | "ingredient" | "drink" | "packaged";

/**
 * Where an item's nutrients come from: a matched food, the sum of a mixed dish's components, the
 * model's own estimate (shown as "AI estimate"), a Mealie recipe, the person's usual meal, or
 * typed in by hand.
 */
export type NutrientSource = "food" | "components" | "ai_estimate" | "recipe" | "usual" | "manual";

export type PhotoSize = "thumb" | "analysis" | "original";

export type MealPhotoDto = {
  id: string;
  position: number;
  width: number;
  height: number;
  /** Authenticated URLs (only the owner gets the bytes). */
  urls: Record<PhotoSize, string>;
};

export type MealQuestionDto = {
  id: string;
  text: string;
  /** Two to four suggested answers. */
  answers: string[];
  /** The person's answer, once given. */
  answer: string | null;
};

export type MealErrorDto = {
  /** An AiErrorKind (lib/ai/errors.ts) or "not-food", "internal". */
  kind: string;
  message: string;
  /** True when the fix is in the AI settings (missing or refused key, no credit). */
  settingsLink: boolean;
};

export type ItemComponentDto = {
  name: string;
  grams: number;
  foodId: string | null;
  nutrients: NutrientMap;
};

export type MealItemDto = {
  id: string;
  mealId: string;
  position: number;
  name: string;
  localName: string | null;
  kind: ItemKind;
  preparation: string | null;
  /** The matched food, when there is one. */
  foodId: string | null;
  foodName: string | null;
  grams: number;
  /** For drinks: the volume; grams then follow from the food's density. */
  ml: number | null;
  portionText: string | null;
  count: number;
  /** The model's own amount and range, for the grams slider. */
  modelGrams: number | null;
  gramsLow: number | null;
  gramsHigh: number | null;
  confidence: number | null;
  /** Changed by hand; a re-analysis keeps it unless asked to replace edits. */
  edited: boolean;
  /** Amounts for this item (not per 100 g). */
  nutrients: NutrientMap;
  nutrientSource: NutrientSource;
  components: ItemComponentDto[];
};

export type MealSummaryDto = {
  id: string;
  /** ISO time the meal was eaten (the first photo). */
  eatenAt: string;
  /** IANA time zone of the device at that time. */
  tz: string;
  /** The day in that time zone, YYYY-MM-DD. */
  localDate: string;
  /** Local wall-clock time, HH:MM, for display. */
  localTime: string;
  slot: MealSlot;
  title: string | null;
  note: string | null;
  status: MealStatus;
  source: MealSource;
  error: MealErrorDto | null;
  photos: MealPhotoDto[];
  itemCount: number;
  openQuestions: number;
  /** Sum of the items' nutrients. */
  totals: NutrientMap;
  createdAt: string;
  updatedAt: string;
};

export type MealDto = MealSummaryDto & {
  items: MealItemDto[];
  questions: MealQuestionDto[];
};

/** Fields of a meal the person can change. */
export type MealPatch = {
  eatenAt?: string;
  tz?: string;
  slot?: MealSlot;
  title?: string | null;
  note?: string | null;
};

/** A new item (manual add, search result, Mealie recipe). */
export type ItemInput = {
  name: string;
  localName?: string | null;
  kind?: ItemKind;
  foodId?: string | null;
  grams?: number;
  ml?: number | null;
  count?: number;
  portionText?: string | null;
  /** Given when no food is matched (typed in by hand). */
  nutrients?: NutrientMap;
};

/**
 * Changes to an item. Changing grams, ml, count or the food recomputes the nutrients from the
 * food's values per 100 g and marks the item edited.
 */
export type ItemPatch = {
  name?: string;
  grams?: number;
  ml?: number | null;
  count?: number;
  portionText?: string | null;
  foodId?: string | null;
  /** Only for items without a food. */
  nutrients?: NutrientMap;
};

/** Response of POST /api/meals. */
export type CreateMealResponse = { meal: MealSummaryDto; duplicate: boolean };

/** Upload limits shared by the client helper and the route (docs/DESIGN.md section 12). */
export const UPLOAD_LIMITS = {
  maxPhotos: 3,
  maxPhotoBytes: 8 * 1024 * 1024,
  maxRequestBytes: 25 * 1024 * 1024,
  maxNoteChars: 500,
  /** Long edge of the photo the device sends. */
  clientLongEdge: 2048,
  clientJpegQuality: 0.85,
} as const;
