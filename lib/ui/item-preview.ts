// The item sheet's optimistic update: what an item looks like after a change, computed on the
// device the same way lib/meals/service.ts updateItem computes it on the server (from the food's
// values per 100 g when there is a food, otherwise in proportion to the new amount). The server's
// answer replaces it a moment later. Plain functions.
import type { FoodResult } from "@/lib/contracts/food-search";
import type { ItemPatch, MealItemDto } from "@/lib/contracts/meals";
import {
  amountGrams,
  multiplyNutrients,
  nutrientsForAmount,
  sumNutrients,
} from "@/lib/contracts/nutrients";

export const previewItem = (
  item: MealItemDto,
  patch: ItemPatch,
  food: FoodResult | null,
): MealItemDto => {
  const grams = patch.grams ?? item.grams;
  const ml = patch.ml === null ? null : (patch.ml ?? item.ml);
  const count = patch.count ?? item.count ?? 1;
  const next: MealItemDto = {
    ...item,
    name: patch.name ?? item.name,
    grams,
    ml,
    count,
    portionText: patch.portionText === undefined ? item.portionText : patch.portionText,
    edited: true,
  };
  const foodId = patch.foodId === undefined ? item.foodId : patch.foodId;
  if (foodId && food && food.id === foodId) {
    next.foodId = food.id;
    next.foodName = food.nameEn;
    next.nutrients = nutrientsForAmount(food.per100g, { grams, ml, count }, food.densityGPerMl);
    next.nutrientSource = "food";
    return next;
  }
  if (patch.nutrients) {
    next.nutrients = patch.nutrients;
    next.nutrientSource = "manual";
    return next;
  }
  const before = amountGrams({ grams: item.grams, ml: item.ml, count: item.count });
  const after = amountGrams({ grams, ml, count });
  if (before > 0 && after !== before) {
    const factor = after / before;
    next.nutrients = multiplyNutrients(item.nutrients, factor);
    next.components = item.components.map((c) => ({
      ...c,
      grams: c.grams * factor,
      nutrients: multiplyNutrients(c.nutrients, factor),
    }));
  }
  return next;
};

/** The meal's totals from its items, for showing changes before the server answers. */
export const totalsOf = (items: Pick<MealItemDto, "nutrients">[]) =>
  sumNutrients(items.map((i) => i.nutrients));

/** The grams slider's range: the model's low to high estimate, widened to hold the value. */
export const gramsRange = (item: Pick<MealItemDto, "grams" | "gramsLow" | "gramsHigh">) => {
  const value = item.grams > 0 ? item.grams : 100;
  let low = item.gramsLow && item.gramsLow > 0 ? item.gramsLow : value * 0.5;
  let high = item.gramsHigh && item.gramsHigh > low ? item.gramsHigh : value * 1.75;
  low = Math.min(low, value);
  high = Math.max(high, value);
  // A little room on both sides, rounded to friendly numbers.
  const step = high - low > 300 ? 10 : high - low > 60 ? 5 : 1;
  return {
    min: Math.max(1, Math.floor((low * 0.8) / step) * step),
    max: Math.ceil((high * 1.2) / step) * step,
    step,
  };
};
