// CONTRACT: the nutrient catalogue and nutrient math shared by the app, the worker and the scripts.
//
// A NutrientMap holds amounts by nutrient code: the codes below for the nutrients Kal shows,
// and "fdc:<id>" for any other value imported from FoodData Central (all FDC values are kept).
// Units are fixed per code (see NUTRIENT_CATALOGUE); energy is kcal. Foods store their map per
// 100 g; meal items store the map for their own amount. Plain data, safe for client components.

export const NUTRIENT_CODES = [
  "energy",
  "protein",
  "fat",
  "fat_sat",
  "fat_mono",
  "fat_poly",
  "fat_trans",
  "cholesterol",
  "carbs",
  "fiber",
  "sugars",
  "sugars_added",
  "sodium",
  "potassium",
  "calcium",
  "iron",
  "magnesium",
  "phosphorus",
  "zinc",
  "copper",
  "selenium",
  "vit_a",
  "vit_c",
  "vit_d",
  "vit_e",
  "vit_k",
  "thiamin",
  "riboflavin",
  "niacin",
  "vit_b6",
  "vit_b12",
  "folate",
  "choline",
  "caffeine",
  "alcohol",
  "water",
] as const;

export type NutrientCode = (typeof NUTRIENT_CODES)[number];
export type NutrientUnit = "kcal" | "g" | "mg" | "µg";
export type NutrientGroup = "energy" | "macro" | "fat" | "carb" | "mineral" | "vitamin" | "other";

/** Amounts by nutrient code (NutrientCode or "fdc:<id>"). Missing means unknown, not zero. */
export type NutrientMap = Partial<Record<NutrientCode, number>> & { [code: string]: number };

export type NutrientInfo = {
  code: NutrientCode;
  name: string;
  /** Short label for tight spaces such as bars and chips. */
  short: string;
  unit: NutrientUnit;
  group: NutrientGroup;
  order: number;
  /** FoodData Central nutrient ids that map to this code, preferred first. */
  fdcIds: number[];
  /** Decimal places shown. */
  decimals: number;
};

const n = (
  code: NutrientCode,
  name: string,
  short: string,
  unit: NutrientUnit,
  group: NutrientGroup,
  fdcIds: number[],
  decimals: number,
): Omit<NutrientInfo, "order"> => ({ code, name, short, unit, group, fdcIds, decimals });

export const NUTRIENT_CATALOGUE: readonly NutrientInfo[] = [
  n("energy", "Energy", "Calories", "kcal", "energy", [1008, 2047, 2048], 0),
  n("protein", "Protein", "Protein", "g", "macro", [1003], 1),
  n("fat", "Fat", "Fat", "g", "macro", [1004, 1085], 1),
  n("fat_sat", "Saturated fat", "Sat. fat", "g", "fat", [1258], 1),
  n("fat_mono", "Monounsaturated fat", "Mono fat", "g", "fat", [1292], 1),
  n("fat_poly", "Polyunsaturated fat", "Poly fat", "g", "fat", [1293], 1),
  n("fat_trans", "Trans fat", "Trans fat", "g", "fat", [1257], 1),
  n("cholesterol", "Cholesterol", "Cholesterol", "mg", "fat", [1253], 0),
  n("carbs", "Carbohydrate", "Carbs", "g", "macro", [1005, 1050], 1),
  n("fiber", "Fiber", "Fiber", "g", "carb", [1079], 1),
  n("sugars", "Total sugars", "Sugars", "g", "carb", [2000, 1063], 1),
  n("sugars_added", "Added sugars", "Added sugar", "g", "carb", [1235], 1),
  n("sodium", "Sodium", "Sodium", "mg", "mineral", [1093], 0),
  n("potassium", "Potassium", "Potassium", "mg", "mineral", [1092], 0),
  n("calcium", "Calcium", "Calcium", "mg", "mineral", [1087], 0),
  n("iron", "Iron", "Iron", "mg", "mineral", [1089], 1),
  n("magnesium", "Magnesium", "Magnesium", "mg", "mineral", [1090], 0),
  n("phosphorus", "Phosphorus", "Phosphorus", "mg", "mineral", [1091], 0),
  n("zinc", "Zinc", "Zinc", "mg", "mineral", [1095], 1),
  n("copper", "Copper", "Copper", "mg", "mineral", [1098], 2),
  n("selenium", "Selenium", "Selenium", "µg", "mineral", [1103], 0),
  n("vit_a", "Vitamin A (RAE)", "Vit. A", "µg", "vitamin", [1106], 0),
  n("vit_c", "Vitamin C", "Vit. C", "mg", "vitamin", [1162], 0),
  n("vit_d", "Vitamin D", "Vit. D", "µg", "vitamin", [1114], 1),
  n("vit_e", "Vitamin E", "Vit. E", "mg", "vitamin", [1109], 1),
  n("vit_k", "Vitamin K", "Vit. K", "µg", "vitamin", [1185], 0),
  n("thiamin", "Thiamin (B1)", "B1", "mg", "vitamin", [1165], 2),
  n("riboflavin", "Riboflavin (B2)", "B2", "mg", "vitamin", [1166], 2),
  n("niacin", "Niacin (B3)", "B3", "mg", "vitamin", [1167], 1),
  n("vit_b6", "Vitamin B6", "B6", "mg", "vitamin", [1175], 2),
  n("vit_b12", "Vitamin B12", "B12", "µg", "vitamin", [1178], 1),
  n("folate", "Folate (DFE)", "Folate", "µg", "vitamin", [1190], 0),
  n("choline", "Choline", "Choline", "mg", "other", [1180], 0),
  n("caffeine", "Caffeine", "Caffeine", "mg", "other", [1057], 0),
  n("alcohol", "Alcohol", "Alcohol", "g", "other", [1018], 1),
  n("water", "Water", "Water", "g", "other", [1051], 0),
].map((info, order) => ({ ...info, order }));

const BY_CODE = new Map(NUTRIENT_CATALOGUE.map((info) => [info.code as string, info]));

export const isNutrientCode = (value: unknown): value is NutrientCode =>
  typeof value === "string" && BY_CODE.has(value);

export const nutrientInfo = (code: string): NutrientInfo | undefined => BY_CODE.get(code);

/** The four values every card shows. */
export const MACRO_CODES = ["energy", "protein", "carbs", "fat"] as const satisfies NutrientCode[];

// ---- Math ----

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Multiplies every amount by a factor. Unknown values stay unknown. */
export const multiplyNutrients = (map: NutrientMap, factor: number): NutrientMap => {
  const out: NutrientMap = {};
  if (!finite(factor) || factor < 0) return out;
  for (const [code, value] of Object.entries(map)) if (finite(value)) out[code] = value * factor;
  return out;
};

/** Amounts for a weight, from values per 100 g. */
export const scaleNutrients = (per100g: NutrientMap, grams: number): NutrientMap =>
  multiplyNutrients(per100g, finite(grams) && grams > 0 ? grams / 100 : 0);

/** Default density of drinks when a food has none recorded (water). */
export const DEFAULT_DENSITY_G_PER_ML = 1;

/** Grams of a volume, from the food's density in g/ml (water when unknown). */
export const gramsFromMl = (ml: number, densityGPerMl?: number | null) =>
  finite(ml) && ml > 0
    ? ml * (finite(densityGPerMl) && densityGPerMl > 0 ? densityGPerMl : DEFAULT_DENSITY_G_PER_ML)
    : 0;

/** Millilitres of a weight, the inverse of gramsFromMl. */
export const mlFromGrams = (grams: number, densityGPerMl?: number | null) =>
  finite(grams) && grams > 0
    ? grams /
      (finite(densityGPerMl) && densityGPerMl > 0 ? densityGPerMl : DEFAULT_DENSITY_G_PER_ML)
    : 0;

export type Amount = {
  /** Weight in grams; used when ml is not given. */
  grams?: number | null;
  /** Volume in millilitres (drinks); converted with the density. */
  ml?: number | null;
  /** How many of the amount (a stepper on the item sheet). Default 1. */
  count?: number | null;
};

/** The weight an amount stands for: ml through the density, times the count. */
export const amountGrams = (amount: Amount, densityGPerMl?: number | null) => {
  const count = finite(amount.count) && amount.count > 0 ? amount.count : 1;
  const base =
    finite(amount.ml) && amount.ml > 0
      ? gramsFromMl(amount.ml, densityGPerMl)
      : finite(amount.grams) && amount.grams > 0
        ? amount.grams
        : 0;
  return base * count;
};

/** Nutrients of an amount of a food: per 100 g x grams / 100, ml through the density. */
export const nutrientsForAmount = (
  per100g: NutrientMap,
  amount: Amount,
  densityGPerMl?: number | null,
): NutrientMap => scaleNutrients(per100g, amountGrams(amount, densityGPerMl));

/** Sums maps code by code. A code known in any map is kept. */
export const sumNutrients = (maps: Iterable<NutrientMap>): NutrientMap => {
  const out: NutrientMap = {};
  for (const map of maps)
    for (const [code, value] of Object.entries(map))
      if (finite(value)) out[code] = (out[code] ?? 0) + value;
  return out;
};

export const addNutrients = (a: NutrientMap, b: NutrientMap) => sumNutrients([a, b]);

/**
 * Values per 100 g of a mixture, from its parts (for example a dish from its components).
 * Returns an empty map when the parts weigh nothing.
 */
export const per100gOfMixture = (parts: { grams: number; per100g: NutrientMap }[]) => {
  const total = parts.reduce((sum, part) => sum + (finite(part.grams) ? part.grams : 0), 0);
  if (total <= 0) return {} as NutrientMap;
  return multiplyNutrients(
    sumNutrients(parts.map((part) => scaleNutrients(part.per100g, part.grams))),
    100 / total,
  );
};

/** Energy in kcal from macronutrients (Atwater factors 4, 4, 9 and 7 for alcohol). */
export const energyFromMacros = (map: NutrientMap) =>
  4 * (map.protein ?? 0) + 4 * (map.carbs ?? 0) + 9 * (map.fat ?? 0) + 7 * (map.alcohol ?? 0);

/** Rounds a value to the precision the catalogue shows for its code. */
export const roundNutrient = (code: string, value: number) => {
  const decimals = nutrientInfo(code)?.decimals ?? 1;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Text for a value with its unit, for example "12.5 g" or "640 kcal". */
export const formatNutrient = (code: string, value: number | null | undefined) => {
  const info = nutrientInfo(code);
  if (!finite(value)) return "–";
  const rounded = roundNutrient(code, value);
  return `${rounded.toLocaleString("en-US", { maximumFractionDigits: info?.decimals ?? 1 })} ${info?.unit ?? ""}`.trim();
};

/** The rough nutrients a vision model gives as a last resort (sodium in mg). */
export type NutrientEstimate = {
  kcal?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  sugar?: number | null;
  sodium?: number | null;
};

/** Turns a model's estimate into a NutrientMap (labelled "AI estimate" wherever it is shown). */
export const estimateToNutrients = (estimate: NutrientEstimate | null | undefined) => {
  const out: NutrientMap = {};
  if (!estimate) return out;
  const pairs: [keyof NutrientEstimate, NutrientCode][] = [
    ["kcal", "energy"],
    ["protein", "protein"],
    ["carbs", "carbs"],
    ["fat", "fat"],
    ["fiber", "fiber"],
    ["sugar", "sugars"],
    ["sodium", "sodium"],
  ];
  for (const [from, to] of pairs) {
    const value = estimate[from];
    if (finite(value) && value >= 0) out[to] = value;
  }
  return out;
};
