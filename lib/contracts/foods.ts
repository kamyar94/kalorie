// CONTRACT: personal foods, dishes, the person's food memory and barcode lookup (docs/DESIGN.md
// section 5), next to food-search.ts. Implementations:
//
//   lib/food/custom-foods.ts
//     createCustomFood(userId, input)             -> FoodResult
//     updateCustomFood(userId, foodId, patch)     -> FoodResult | null
//     deleteCustomFood(userId, foodId)            -> boolean   (FoodInputError "in_use")
//     copyFood(userId, foodId, overrides?)        -> FoodResult | null
//     listCustomFoods(userId, { kinds?, limit? }) -> FoodResult[]
//   lib/food/dishes.ts
//     createDish(userId, input)                   -> FoodResult (kind "dish")
//     updateDish(userId, dishId, patch)           -> FoodResult | null
//     getDishComponents(userId, dishId)           -> DishComponentDto[] | null
//     recomputeDishesUsing(foodIds)               -> number (dishes updated)
//   lib/food/memory.ts
//     rememberFood(userId, correction)            -> FoodMemoryEntry | null
//     recallFoods(userId, names)                  -> Map<name, FoodMemoryEntry>
//     usualFoods(userId, { limit? })              -> FoodMemoryEntry[]
//     recentFoods(userId, { limit? })             -> RecentFood[]
//     frequentFoods(userId, { limit?, days? })    -> RecentFood[]
//     forgetFood(userId, memoryId)                -> boolean
//   lib/food/off.ts
//     lookupBarcode(userId, code, options?)       -> BarcodeLookup
//   lib/food/barcode.ts (client-safe)
//     normalizeBarcode(code), isValidGtin(digits)
//
// Every function takes the user id first and an optional last dbx (db or a transaction). Another
// person's id behaves like a missing id. Bad input throws FoodInputError (lib/food/errors.ts)
// with a field name and a message fit to show.
import type { FoodKind, FoodResult } from "./food-search";
import type { NutrientMap } from "./nutrients";

export type PortionInput = {
  /** "1 slice", "1 bowl". */
  label: string;
  labelFa?: string | null;
  grams: number;
  amount?: number;
  unit?: string;
};

/** A food the person makes. Give per100g, or perServing together with servingGrams. */
export type CustomFoodInput = {
  nameEn: string;
  nameFa?: string | null;
  synonyms?: string[];
  category?: string | null;
  brand?: string | null;
  barcode?: string | null;
  kind?: Extract<FoodKind, "food" | "packaged">;
  per100g?: NutrientMap;
  perServing?: NutrientMap;
  servingGrams?: number | null;
  densityGPerMl?: number | null;
  portions?: PortionInput[];
  sourceNote?: string | null;
};

export type DishComponentInput = { foodId: string; grams: number; note?: string | null };

/**
 * A dish: components in grams for one serving. servingGrams is the finished serving's weight
 * (cooking loses or gains water); leave it out and it is the components' sum.
 */
export type DishInput = {
  nameEn: string;
  nameFa?: string | null;
  synonyms?: string[];
  category?: string | null;
  servingGrams?: number | null;
  components: DishComponentInput[];
  portions?: PortionInput[];
  sourceNote?: string | null;
};

export type DishComponentDto = {
  id: number;
  foodId: string;
  nameEn: string;
  nameFa: string | null;
  source: FoodResult["source"];
  grams: number;
  note: string | null;
  per100g: NutrientMap;
  /** Values for this component's grams. */
  nutrients: NutrientMap;
};

/** What Cal learned from one correction (food_memory row). */
export type FoodMemoryEntry = {
  id: number;
  /** normalizeFoodText of the name the item had ("ghormeh sabzi", "قورمه سبزی"). */
  nameKey: string;
  displayName: string;
  foodId: string | null;
  /** The food's name, when it is still visible to the person. */
  foodName: string | null;
  typicalGrams: number | null;
  count: number;
  lastUsedAt: string;
  /** The corrected item as the caller saved it (for "usual meals"). */
  snapshot: unknown;
};

/**
 * One correction: the item's name as the model gave it (and its Persian name), the food the
 * person chose, and the grams they kept. Call it whenever a person sets or changes an item's
 * food or grams by hand.
 */
export type FoodCorrection = {
  name: string;
  localName?: string | null;
  foodId: string;
  grams?: number | null;
  snapshot?: unknown;
  at?: Date;
};

export type RecentFood = {
  food: FoodResult;
  /** Times logged or corrected in the period. */
  count: number;
  lastUsedAt: string;
  typicalGrams: number | null;
};

export type BarcodeLookup =
  | { status: "found"; food: FoodResult; fresh: boolean }
  | { status: "not_found" | "invalid" | "unavailable" | "rate_limited"; food: null };
