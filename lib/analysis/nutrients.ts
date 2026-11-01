// Nutrients of one analysed item (docs/DESIGN.md section 4 step 4), in this order:
//   1. a usual meal of the person without a database food: their corrected values, scaled;
//   2. a planned Mealie recipe with nutrition: per serving x servings;
//   3. a matched food: per 100 g x grams / 100 (drinks: ml through the food's density);
//   4. a mixed dish without a match: the sum of its matched components (the unmatched rest from
//      the model's estimate, by weight);
//   5. nothing matched: the model's own estimate, labelled "AI estimate".
// The result says where the numbers come from (NutrientSource). Pure code, no database.
import type { ItemComponentRow } from "@/db/schema";
import type { AnalysisItem, PlannedRecipe } from "@/lib/contracts/analysis";
import type { FoodResult } from "@/lib/contracts/food-search";
import type { NutrientSource } from "@/lib/contracts/meals";
import {
  estimateToNutrients,
  gramsFromMl,
  multiplyNutrients,
  nutrientsForAmount,
  sumNutrients,
  type NutrientMap,
} from "@/lib/contracts/nutrients";

/** A usual meal's stored values (food_memory.snapshot): nutrients for its grams. */
export type UsualSnapshot = {
  grams: number;
  nutrients: NutrientMap;
  components?: ItemComponentRow[];
};

export type ItemResolution = {
  item: AnalysisItem;
  /** The matched database food (AI choice, trigram fallback, memory, barcode or label). */
  food: FoodResult | null;
  /** The item's components with their matched foods (same order as item.components). */
  components: { name: string; grams: number; food: FoodResult | null }[];
  /** A usual meal the item is, when it has no database food. */
  usual: UsualSnapshot | null;
  /** A planned recipe the item is. */
  planned: PlannedRecipe | null;
};

export type ComputedItem = {
  foodId: string | null;
  grams: number;
  ml: number | null;
  gramsLow: number | null;
  gramsHigh: number | null;
  nutrients: NutrientMap;
  source: NutrientSource;
  components: ItemComponentRow[];
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** A map that can stand for an item's numbers: it knows the energy (0 is fine, water). */
export const hasEnergy = (map: NutrientMap | null | undefined): map is NutrientMap =>
  !!map && finite(map.energy) && map.energy >= 0;

const round = (value: number) => Math.round(value * 10) / 10;

/** Components scaled so their grams add up to the item's grams. */
export const scaleComponents = <T extends { grams: number }>(
  components: T[],
  grams: number,
): T[] => {
  const total = components.reduce((sum, c) => sum + (finite(c.grams) ? c.grams : 0), 0);
  if (total <= 0 || grams <= 0 || Math.abs(total - grams) / grams < 0.02) return components;
  const factor = grams / total;
  return components.map((c) => ({ ...c, grams: round(c.grams * factor) }));
};

/** Nutrients for each component: its food's values, or a weight share of the item's estimate. */
const componentRows = (
  resolution: ItemResolution,
  grams: number,
  estimate: NutrientMap,
): { rows: ItemComponentRow[]; matched: number } => {
  const scaled = scaleComponents(resolution.components, grams);
  const total = scaled.reduce((sum, c) => sum + c.grams, 0);
  let matched = 0;
  const rows = scaled.map((c) => {
    if (c.food && hasEnergy(c.food.per100g)) {
      matched += 1;
      return {
        name: c.name,
        grams: c.grams,
        foodId: c.food.id,
        nutrients: nutrientsForAmount(c.food.per100g, { grams: c.grams }, c.food.densityGPerMl),
      };
    }
    return {
      name: c.name,
      grams: c.grams,
      foodId: null,
      nutrients: total > 0 ? multiplyNutrients(estimate, c.grams / total) : {},
    };
  });
  return { rows, matched };
};

export const computeItemNutrients = (resolution: ItemResolution): ComputedItem => {
  const { item, food, usual, planned } = resolution;
  const modelGrams = finite(item.grams) && item.grams > 0 ? item.grams : 100;
  const estimate = estimateToNutrients(item.estimate);
  const base = {
    grams: modelGrams,
    ml: item.ml,
    gramsLow: item.grams_low,
    gramsHigh: item.grams_high,
  };

  // 1. The person's usual meal (their corrected values), scaled to this portion.
  if (usual && usual.grams > 0 && hasEnergy(usual.nutrients)) {
    const factor = modelGrams / usual.grams;
    return {
      ...base,
      foodId: null,
      nutrients: multiplyNutrients(usual.nutrients, factor),
      source: "usual",
      components: scaleComponents(
        (usual.components ?? []).map((c) => ({
          ...c,
          grams: round(c.grams * factor),
          nutrients: c.nutrients ? multiplyNutrients(c.nutrients, factor) : {},
        })),
        modelGrams,
      ),
    };
  }

  // 2. A planned recipe with nutrition per serving.
  if (planned && hasEnergy(planned.nutritionPerServing)) {
    const servings =
      planned.servingGrams && planned.servingGrams > 0 ? modelGrams / planned.servingGrams : 1;
    return {
      ...base,
      foodId: planned.foodId,
      nutrients: multiplyNutrients(planned.nutritionPerServing, servings),
      source: "recipe",
      components: componentRows(resolution, modelGrams, estimate).rows,
    };
  }

  // 3. A matched food. Drinks are measured in ml; their weight follows from the density.
  if (food && hasEnergy(food.per100g)) {
    const grams =
      item.ml && item.ml > 0 ? round(gramsFromMl(item.ml, food.densityGPerMl)) : modelGrams;
    const factor = grams / modelGrams;
    return {
      foodId: food.id,
      grams,
      ml: item.ml,
      gramsLow: item.grams_low === null ? null : round(item.grams_low * factor),
      gramsHigh: item.grams_high === null ? null : round(item.grams_high * factor),
      nutrients: nutrientsForAmount(food.per100g, { grams, ml: item.ml }, food.densityGPerMl),
      source: "food",
      components: componentRows(resolution, grams, estimate).rows,
    };
  }

  // 4. A mixed dish: its matched components, the rest from the estimate by weight.
  const { rows, matched } = componentRows(resolution, modelGrams, estimate);
  if (matched > 0) {
    return {
      ...base,
      foodId: null,
      nutrients: sumNutrients(rows.map((r) => r.nutrients ?? {})),
      source: "components",
      components: rows,
    };
  }

  // 5. The model's own estimate.
  return { ...base, foodId: null, nutrients: estimate, source: "ai_estimate", components: rows };
};
