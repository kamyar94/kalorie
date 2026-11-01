// CONTRACT: food search, as the analysis (matching), the item sheet ("change") and the add screen
// use it. Implemented in lib/food/search.ts (ranked full text and trigram search over
// foods.search_text, the person's own and remembered foods first; the ranking is described there).
//
//   searchFoods({ query, userId, limit })  -> FoodResult[]   best first, at most limit (default 20)
//   getFood(foodId, userId)                -> FoodResult | null   (null when not visible to userId)
//   getFoodsByIds(ids, userId)             -> Map<id, FoodResult>
//
// Visibility: shared foods (owner_id null) and the person's own foods only.
import type { NutrientMap } from "./nutrients";

export type FoodSource =
  "fdc_foundation" | "fdc_sr_legacy" | "fdc_fndds" | "off" | "dish" | "user" | "mealie" | "ai";

export type FoodKind = "food" | "dish" | "recipe" | "packaged";

export type FoodPortionDto = {
  id: number;
  /** "1 cup", "1 skewer". */
  label: string;
  labelFa: string | null;
  amount: number;
  unit: string;
  grams: number;
};

export type FoodResult = {
  id: string;
  source: FoodSource;
  kind: FoodKind;
  nameEn: string;
  nameFa: string | null;
  brand: string | null;
  category: string | null;
  barcode: string | null;
  /** Values per 100 g. */
  per100g: NutrientMap;
  /** g/ml for drinks; null means water's density is assumed. */
  densityGPerMl: number | null;
  /** One serving of a dish or recipe, in grams. */
  servingGrams: number | null;
  portions: FoodPortionDto[];
  /** Where the numbers come from ("USDA FoodData Central", "recipe estimate", ODbL notice). */
  sourceNote: string | null;
  /** The person's own food or dish. */
  personal: boolean;
  /** Ranking score, higher is better; comparable only within one result list. */
  score: number;
};

export type FoodSearchQuery = {
  query: string;
  userId: string;
  /** Default 20, at most 50. */
  limit?: number;
  /** Only these kinds. */
  kinds?: FoodKind[];
};

export type SearchFoods = (query: FoodSearchQuery) => Promise<FoodResult[]>;
export type GetFood = (foodId: string, userId: string) => Promise<FoodResult | null>;
