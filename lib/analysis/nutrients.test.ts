import { describe, expect, it } from "vitest";

import type { AnalysisItem, PlannedRecipe } from "@/lib/contracts/analysis";
import type { FoodResult } from "@/lib/contracts/food-search";
import type { NutrientMap } from "@/lib/contracts/nutrients";

import { computeItemNutrients, hasEnergy, scaleComponents, type ItemResolution } from "./nutrients";

const item = (overrides: Partial<AnalysisItem> = {}): AnalysisItem => ({
  name: "Item",
  local_name: null,
  kind: "dish",
  emoji: null,
  preparation: null,
  grams: 200,
  ml: null,
  grams_low: 150,
  grams_high: 260,
  portion_text: null,
  confidence: 0.8,
  photo_indexes: [0],
  search_terms: ["item"],
  matches_usual: null,
  matches_planned: null,
  components: [],
  label: null,
  estimate: { kcal: 300, protein: 10, carbs: 40, fat: 10, fiber: 2, sugar: 3, sodium: 400 },
  ...overrides,
});

const food = (id: string, per100g: NutrientMap, density: number | null = null): FoodResult => ({
  id,
  source: "fdc_sr_legacy",
  kind: "food",
  nameEn: id,
  nameFa: null,
  brand: null,
  category: null,
  barcode: null,
  per100g,
  densityGPerMl: density,
  servingGrams: null,
  portions: [],
  sourceNote: null,
  personal: false,
  score: 1,
});

const resolve = (overrides: Partial<ItemResolution>): ItemResolution => ({
  item: item(),
  food: null,
  components: [],
  usual: null,
  planned: null,
  ...overrides,
});

describe("computeItemNutrients", () => {
  it("scales a matched food's values per 100 g to the grams", () => {
    const result = computeItemNutrients(
      resolve({ food: food("rice", { energy: 130, protein: 2.7, "fdc:1234": 5 }) }),
    );
    expect(result).toMatchObject({ foodId: "rice", source: "food", grams: 200 });
    expect(result.nutrients).toEqual({ energy: 260, protein: 5.4, "fdc:1234": 10 });
  });

  it("weighs drinks through the food's density and moves the range with it", () => {
    const juice = food("juice", { energy: 45 }, 1.04);
    const result = computeItemNutrients(
      resolve({
        item: item({ kind: "drink", grams: 300, ml: 300, grams_low: 250, grams_high: 350 }),
        food: juice,
      }),
    );
    expect(result.grams).toBeCloseTo(312, 5);
    expect(result.ml).toBe(300);
    expect(result.gramsLow).toBeCloseTo(260, 5);
    expect(result.nutrients.energy).toBeCloseTo(140.4, 5);
    // Unknown density: water.
    const water = computeItemNutrients(
      resolve({
        item: item({ kind: "drink", grams: 500, ml: 500 }),
        food: food("tea", { energy: 1 }),
      }),
    );
    expect(water.grams).toBe(500);
  });

  it("sums matched components and shares the estimate over the unmatched ones by weight", () => {
    const result = computeItemNutrients(
      resolve({
        item: item({ grams: 200 }),
        components: [
          { name: "Beef", grams: 100, food: food("beef", { energy: 250, protein: 30 }) },
          { name: "Herbs", grams: 100, food: null },
        ],
      }),
    );
    expect(result.source).toBe("components");
    expect(result.foodId).toBeNull();
    expect(result.components).toEqual([
      { name: "Beef", grams: 100, foodId: "beef", nutrients: { energy: 250, protein: 30 } },
      {
        name: "Herbs",
        grams: 100,
        foodId: null,
        nutrients: {
          energy: 150,
          protein: 5,
          carbs: 20,
          fat: 5,
          fiber: 1,
          sugars: 1.5,
          sodium: 200,
        },
      },
    ]);
    expect(result.nutrients).toMatchObject({ energy: 400, protein: 35, carbs: 20 });
  });

  it("uses the model's estimate, labelled, when nothing matched", () => {
    const result = computeItemNutrients(
      resolve({
        item: item({ components: [{ name: "Herbs", grams: 200 }] }),
        components: [{ name: "Herbs", grams: 200, food: null }],
      }),
    );
    expect(result.source).toBe("ai_estimate");
    expect(result.nutrients).toEqual({
      energy: 300,
      protein: 10,
      carbs: 40,
      fat: 10,
      fiber: 2,
      sugars: 3,
      sodium: 400,
    });
  });

  it("scales the person's usual values to the new portion before anything else", () => {
    const result = computeItemNutrients(
      resolve({
        item: item({ grams: 300 }),
        food: food("rice", { energy: 130 }),
        usual: {
          grams: 200,
          nutrients: { energy: 400, protein: 20 },
          components: [{ name: "Eggs", grams: 200, foodId: null, nutrients: { energy: 400 } }],
        },
      }),
    );
    expect(result.source).toBe("usual");
    expect(result.nutrients).toEqual({ energy: 600, protein: 30 });
    expect(result.components).toEqual([
      { name: "Eggs", grams: 300, foodId: null, nutrients: { energy: 600 } },
    ]);
  });

  it("counts a planned recipe per serving", () => {
    const planned: PlannedRecipe = {
      id: "r1",
      name: "Curry",
      slot: null,
      foodId: "food-r1",
      servingGrams: 400,
      nutritionPerServing: { energy: 600, protein: 40 },
    };
    const result = computeItemNutrients(resolve({ item: item({ grams: 600 }), planned }));
    expect(result).toMatchObject({ source: "recipe", foodId: "food-r1" });
    expect(result.nutrients).toEqual({ energy: 900, protein: 60 });
    const oneServing = computeItemNutrients(
      resolve({ item: item({ grams: 250 }), planned: { ...planned, servingGrams: null } }),
    );
    expect(oneServing.nutrients).toEqual({ energy: 600, protein: 40 });
  });

  it("ignores foods without energy values", () => {
    const result = computeItemNutrients(resolve({ food: food("empty", { protein: 3 }) }));
    expect(result.source).toBe("ai_estimate");
    expect(hasEnergy({ energy: 0 })).toBe(true);
    expect(hasEnergy({})).toBe(false);
  });
});

describe("scaleComponents", () => {
  it("makes the parts add up to the item's grams, leaving close sums alone", () => {
    expect(scaleComponents([{ grams: 100 }, { grams: 50 }], 300)).toEqual([
      { grams: 200 },
      { grams: 100 },
    ]);
    const close = [{ grams: 99 }, { grams: 100 }];
    expect(scaleComponents(close, 200)).toBe(close);
    expect(scaleComponents([], 200)).toEqual([]);
  });
});
