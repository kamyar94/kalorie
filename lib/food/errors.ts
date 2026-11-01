// Input checks for the food services. FoodInputError carries the field and a message fit to show
// on a form; "code" is stable for callers that branch on it.
import { isNutrientCode, nutrientInfo, type NutrientMap } from "@/lib/contracts/nutrients";
import type { PortionInput } from "@/lib/contracts/foods";

export type FoodInputCode = "invalid" | "not_found" | "in_use" | "cycle";

export class FoodInputError extends Error {
  constructor(
    message: string,
    readonly field: string | null = null,
    readonly code: FoodInputCode = "invalid",
  ) {
    super(message);
    this.name = "FoodInputError";
  }
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const cleanName = (value: unknown, field: string, required: boolean, max = 120) => {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) {
    if (required) throw new FoodInputError("Give a name.", field);
    return null;
  }
  if (text.length > max) throw new FoodInputError(`Use at most ${max} characters.`, field);
  return text;
};

export const cleanSynonyms = (values: unknown) => {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) throw new FoodInputError("Other names must be a list.", "synonyms");
  const out: string[] = [];
  for (const value of values) {
    const text = cleanName(value, "synonyms", false, 80);
    if (text && !out.some((s) => s.toLowerCase() === text.toLowerCase())) out.push(text);
  }
  if (out.length > 20) throw new FoodInputError("Use at most 20 other names.", "synonyms");
  return out;
};

/** Grams for an amount: above 0 and at most max. */
export const cleanGrams = (value: unknown, field: string, max = 5000) => {
  if (!finite(value) || value <= 0 || value > max)
    throw new FoodInputError(`Give a weight between 0 and ${max} g.`, field);
  return Math.round(value * 100) / 100;
};

/**
 * A nutrient map as a person may enter it: known codes (or "fdc:<id>"), finite values of 0 or
 * more; per 100 g, energy at most 1000 kcal and gram values at most 100 g.
 */
export const cleanNutrients = (value: unknown, field: string, per100g: boolean): NutrientMap => {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value))
    throw new FoodInputError("Nutrients must be a list of values.", field);
  const out: NutrientMap = {};
  for (const [code, amount] of Object.entries(value as Record<string, unknown>)) {
    if (amount === null || amount === undefined) continue;
    if (!isNutrientCode(code) && !/^fdc:\d+$/.test(code))
      throw new FoodInputError(`Unknown nutrient "${code}".`, field);
    if (!finite(amount) || amount < 0)
      throw new FoodInputError(`Give a value of 0 or more for ${code}.`, field);
    if (per100g) {
      const unit = nutrientInfo(code)?.unit;
      if (code === "energy" && amount > 1000)
        throw new FoodInputError("Energy cannot be above 1000 kcal per 100 g.", field);
      if (unit === "g" && amount > 100)
        throw new FoodInputError(
          `${nutrientInfo(code)?.name} cannot be above 100 g per 100 g.`,
          field,
        );
    }
    out[code] = Math.round(amount * 10_000) / 10_000;
  }
  return out;
};

export type CleanPortion = {
  label: string;
  labelFa: string | null;
  grams: number;
  amount: number;
  unit: string;
};

export const cleanPortions = (values: unknown): CleanPortion[] => {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) throw new FoodInputError("Portions must be a list.", "portions");
  if (values.length > 20) throw new FoodInputError("Use at most 20 portions.", "portions");
  return values.map((value: PortionInput) => ({
    label: cleanName(value?.label, "portions", true, 60)!,
    labelFa: cleanName(value?.labelFa, "portions", false, 60),
    grams: cleanGrams(value?.grams, "portions"),
    amount: finite(value?.amount) && value.amount > 0 ? value.amount : 1,
    unit: cleanName(value?.unit, "portions", false, 30) ?? "portion",
  }));
};

export const cleanDensity = (value: unknown) => {
  if (value === undefined || value === null) return null;
  if (!finite(value) || value < 0.3 || value > 3)
    throw new FoodInputError("Give a density between 0.3 and 3 g per ml.", "densityGPerMl");
  return value;
};
