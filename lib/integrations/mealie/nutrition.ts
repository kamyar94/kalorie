// Mealie's nutrition fields (strings per serving, for example "350", "350 kcal", "12.5 g",
// "1,200 mg") to Cal's nutrient codes and back. Pure code.
//
// Units: Mealie labels calories in kcal, sodium and cholesterol in milligrams and the rest in
// grams. A number with its own unit ("0.5 g" sodium, "1500 kJ") is converted.
import type { NutrientMap } from "@/lib/contracts/nutrients";

import type { MealieNutrition, MealieNutritionKey } from "./client";

type FieldInfo = { code: string; unit: "kcal" | "g" | "mg"; decimals: number };

/** Mealie field -> Cal nutrient code and the unit Mealie means by a bare number. */
export const MEALIE_FIELDS: Partial<Record<MealieNutritionKey, FieldInfo>> = {
  calories: { code: "energy", unit: "kcal", decimals: 0 },
  proteinContent: { code: "protein", unit: "g", decimals: 1 },
  carbohydrateContent: { code: "carbs", unit: "g", decimals: 1 },
  fatContent: { code: "fat", unit: "g", decimals: 1 },
  saturatedFatContent: { code: "fat_sat", unit: "g", decimals: 1 },
  transFatContent: { code: "fat_trans", unit: "g", decimals: 1 },
  fiberContent: { code: "fiber", unit: "g", decimals: 1 },
  sugarContent: { code: "sugars", unit: "g", decimals: 1 },
  sodiumContent: { code: "sodium", unit: "mg", decimals: 0 },
  cholesterolContent: { code: "cholesterol", unit: "mg", decimals: 0 },
};

/** The first number in a text; "1,200" is twelve hundred, "12,5" is twelve and a half. */
export const parseAmount = (value: unknown): { amount: number; unit: string } | null => {
  if (typeof value === "number") return Number.isFinite(value) ? { amount: value, unit: "" } : null;
  if (typeof value !== "string") return null;
  const match = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?|\.\d+)\s*([a-zµμ]*)/i.exec(
    value.trim(),
  );
  if (!match) return null;
  const raw = match[1]!;
  const amount = Number(
    /^\d{1,3}(,\d{3})+/.test(raw) ? raw.replace(/,/g, "") : raw.replace(",", "."),
  );
  return Number.isFinite(amount) ? { amount, unit: match[2]!.toLowerCase() } : null;
};

const convert = (amount: number, unit: string, target: FieldInfo["unit"]) => {
  if (target === "kcal") return unit === "kj" ? amount / 4.184 : amount;
  const grams =
    unit === "mg"
      ? amount / 1000
      : unit === "g"
        ? amount
        : unit === "µg" || unit === "μg" || unit === "mcg"
          ? amount / 1e6
          : null;
  if (grams === null) return amount;
  return target === "g" ? grams : grams * 1000;
};

/** Nutrients of one serving from Mealie's fields; values that do not parse are left out. */
export const mealieToNutrients = (nutrition: MealieNutrition | null | undefined): NutrientMap => {
  const out: NutrientMap = {};
  if (!nutrition) return out;
  for (const [key, info] of Object.entries(MEALIE_FIELDS)) {
    const parsed = parseAmount(nutrition[key as MealieNutritionKey]);
    if (!parsed || parsed.amount < 0) continue;
    out[info.code] = convert(parsed.amount, parsed.unit, info.unit);
  }
  return out;
};

/** Mealie has no usable nutrition: no field holds a number, or energy is missing. */
export const isNutritionEmpty = (nutrition: MealieNutrition | null | undefined) => {
  const values = mealieToNutrients(nutrition);
  return !(typeof values.energy === "number" && values.energy > 0);
};

/** Cal's values of one serving as Mealie's strings (bare numbers in Mealie's units). */
export const nutrientsToMealie = (perServing: NutrientMap): MealieNutrition => {
  const out: MealieNutrition = {};
  for (const [key, info] of Object.entries(MEALIE_FIELDS)) {
    const value = perServing[info.code];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const factor = 10 ** info.decimals;
    out[key as MealieNutritionKey] = String(Math.round(value * factor) / factor);
  }
  return out;
};
