// A Mealie recipe's ingredients as grams of foods Kal knows, for recipes whose nutrition is empty
// (docs/DESIGN.md section 8: "computed from the recipe's ingredients through matching").
//
// Mealie ingredients come parsed ({quantity, unit {name, abbreviation}, food {name}, note}) or as
// plain text ("1 1/2 cups basmati rice, rinsed"); both are read. Amounts become grams through the
// unit (g, kg, oz, lb), through the matched food's household portions ("1 cup" = 158 g of cooked
// rice, "1 large" egg), or through its density for volumes. Matching is the analysis's
// deterministic step: the food search, then the trigram check (lib/analysis/matching.ts).
import type { DbOrTx } from "@/db";
import { chooseByTrigram, type MatchSubject } from "@/lib/analysis/matching";
import type { FoodResult } from "@/lib/contracts/food-search";
import { searchFoods } from "@/lib/food/search";

import type { MealieIngredient } from "./client";

type UnitInfo = { grams?: number; ml?: number; count?: true };

/** Canonical units: grams or millilitres per unit, or a counted piece. */
const UNITS: Record<string, UnitInfo> = {
  g: { grams: 1 },
  kg: { grams: 1000 },
  mg: { grams: 0.001 },
  oz: { grams: 28.3495 },
  lb: { grams: 453.592 },
  ml: { ml: 1 },
  cl: { ml: 10 },
  dl: { ml: 100 },
  l: { ml: 1000 },
  cup: { ml: 240 },
  tbsp: { ml: 15 },
  tsp: { ml: 5 },
  "fl oz": { ml: 29.5735 },
  pinch: { grams: 0.36 },
  dash: { ml: 0.6 },
  piece: { count: true },
  clove: { count: true },
  slice: { count: true },
  large: { count: true },
  medium: { count: true },
  small: { count: true },
  can: { count: true },
  bunch: { count: true },
};

const ALIASES: Record<string, string> = {
  gram: "g",
  grams: "g",
  gr: "g",
  kilogram: "kg",
  kilograms: "kg",
  kilo: "kg",
  milligram: "mg",
  ounce: "oz",
  ounces: "oz",
  pound: "lb",
  pounds: "lb",
  lbs: "lb",
  milliliter: "ml",
  millilitre: "ml",
  milliliters: "ml",
  millilitres: "ml",
  liter: "l",
  litre: "l",
  liters: "l",
  litres: "l",
  cups: "cup",
  c: "cup",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tbs: "tbsp",
  tbl: "tbsp",
  T: "tbsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  t: "tsp",
  "fluid ounce": "fl oz",
  "fluid ounces": "fl oz",
  pinches: "pinch",
  pieces: "piece",
  pc: "piece",
  pcs: "piece",
  whole: "piece",
  cloves: "clove",
  slices: "slice",
  cans: "can",
  bunches: "bunch",
};

/** The canonical unit for a unit name or abbreviation, or null. */
export const canonicalUnit = (value: string | null | undefined) => {
  const text = value?.trim().replace(/\.$/, "");
  if (!text) return null;
  if (ALIASES[text]) return ALIASES[text]!; // "T" and "t" are case sensitive
  const lower = text.toLowerCase();
  if (UNITS[lower]) return lower;
  return ALIASES[lower] ?? null;
};

const FRACTIONS: Record<string, number> = {
  "½": 0.5,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "¼": 0.25,
  "¾": 0.75,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

/** A leading amount: "2", "1.5", "1 1/2", "1½", "½", "3/4", "2-3" (the first). */
export const parseQuantity = (text: string): { quantity: number; rest: string } | null => {
  const glyphs = Object.keys(FRACTIONS).join("");
  const patterns: [RegExp, (m: RegExpExecArray) => number][] = [
    [/^\s*(\d+)\s+(\d+)\s*\/\s*(\d+)/, (m) => Number(m[1]) + Number(m[2]) / Number(m[3])],
    [/^\s*(\d+)\s*\/\s*(\d+)/, (m) => Number(m[1]) / Number(m[2])],
    [
      new RegExp(`^\\s*(\\d+(?:[.,]\\d+)?)\\s*([${glyphs}])?`),
      (m) => Number(m[1]!.replace(",", ".")) + (m[2] ? (FRACTIONS[m[2]] ?? 0) : 0),
    ],
    [new RegExp(`^\\s*([${glyphs}])`), (m) => FRACTIONS[m[1]!] ?? 0],
  ];
  for (const [pattern, value] of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const quantity = value(match);
    if (!Number.isFinite(quantity) || quantity <= 0) return null;
    let rest = text.slice(match[0].length);
    const range = /^\s*(?:-|–|to)\s*\d+(?:[.,]\d+)?/.exec(rest);
    if (range) rest = rest.slice(range[0].length);
    return { quantity, rest };
  }
  return null;
};

export type ParsedIngredient = {
  /** The food's name as written ("basmati rice"). */
  name: string;
  quantity: number | null;
  /** Canonical unit, or null for a bare count ("2 eggs"). */
  unit: string | null;
  /** The ingredient as Mealie shows it, for notes. */
  text: string;
};

const cleanName = (value: string) =>
  value
    .replace(/\(.*?\)/g, " ")
    .split(/[,;]/)[0]!
    .replace(/^\s*of\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

const parseText = (text: string): ParsedIngredient | null => {
  const amount = parseQuantity(text);
  let rest = amount ? amount.rest : text;
  let unit: string | null = null;
  const words = rest.trim().split(/\s+/);
  for (const size of [2, 1]) {
    const candidate = canonicalUnit(words.slice(0, size).join(" "));
    if (candidate && words.length > size) {
      unit = candidate;
      rest = words.slice(size).join(" ");
      break;
    }
  }
  const name = cleanName(rest);
  if (!name) return null;
  return { name, quantity: amount?.quantity ?? null, unit, text: text.trim() };
};

/** One Mealie ingredient as name, amount and unit; null for section titles and empty lines. */
export const parseIngredient = (ingredient: MealieIngredient | string): ParsedIngredient | null => {
  if (typeof ingredient === "string") return parseText(ingredient);
  const foodName = ingredient.food?.name?.trim();
  const text = (ingredient.originalText || ingredient.display || ingredient.note || "").trim();
  if (foodName) {
    const quantity =
      typeof ingredient.quantity === "number" && ingredient.quantity > 0
        ? ingredient.quantity
        : null;
    const unit =
      canonicalUnit(ingredient.unit?.abbreviation) ?? canonicalUnit(ingredient.unit?.name) ?? null;
    return { name: cleanName(foodName), quantity, unit, text: text || foodName };
  }
  return text ? parseText(text) : null;
};

const portionFor = (food: FoodResult, words: string[]) =>
  food.portions.find((p) => {
    const label = `${p.label} ${p.unit}`.toLowerCase();
    return words.some((w) => new RegExp(`\\b${w}\\b`).test(label));
  });

const UNIT_WORDS: Record<string, string[]> = {
  cup: ["cup", "cups"],
  tbsp: ["tbsp", "tablespoon", "tablespoons"],
  tsp: ["tsp", "teaspoon", "teaspoons"],
};

/** Grams of an ingredient once its food is known; null when the amount cannot be worked out. */
export const ingredientGrams = (parsed: ParsedIngredient, food: FoodResult): number | null => {
  if (parsed.quantity === null) return null;
  const info = parsed.unit ? UNITS[parsed.unit] : undefined;
  if (info?.grams) return parsed.quantity * info.grams;
  if (info?.ml) {
    const words = UNIT_WORDS[parsed.unit!];
    const portion = words ? portionFor(food, words) : undefined;
    if (portion && portion.grams > 0) {
      const portionMl = UNITS[parsed.unit!]!.ml! * (portion.amount > 0 ? portion.amount : 1);
      return ((parsed.quantity * info.ml) / portionMl) * portion.grams;
    }
    return parsed.quantity * info.ml * (food.densityGPerMl ?? 1);
  }
  // A counted piece: "2 eggs", "3 cloves garlic", "1 large onion".
  const sizeWords =
    parsed.unit && parsed.unit !== "piece"
      ? [parsed.unit]
      : ["medium", "large", "whole", "piece", "egg", "fruit", "item", "serving"];
  const portion = portionFor(food, sizeWords) ?? food.portions[0];
  if (portion && portion.grams > 0)
    return (parsed.quantity * portion.grams) / (portion.amount > 0 ? portion.amount : 1);
  if (food.servingGrams && food.servingGrams > 0) return parsed.quantity * food.servingGrams;
  return null;
};

export type IngredientPart = { foodId: string; grams: number; name: string };

export type IngredientResult = {
  /** Matched ingredients with grams for the whole recipe. */
  parts: IngredientPart[];
  total: number;
  matched: number;
};

/** Matches each ingredient to a food the person can see and works out its grams. */
export const matchIngredients = async (
  userId: string,
  ingredients: (MealieIngredient | string)[],
  dbx?: DbOrTx,
): Promise<IngredientResult> => {
  const parts: IngredientPart[] = [];
  let total = 0;
  for (const [index, raw] of ingredients.slice(0, 60).entries()) {
    const parsed = parseIngredient(raw);
    if (!parsed) continue;
    total += 1;
    const candidates = await searchFoods({ query: parsed.name, userId, limit: 8 }, dbx);
    const subject: MatchSubject = {
      key: `ingredient:${index}`,
      name: parsed.name,
      localName: null,
      kind: "ingredient",
      preparation: null,
      grams: 0,
      searchTerms: [],
      partOf: null,
      barcode: null,
      memoryFoodId: null,
    };
    // Recipes are not matched to other Mealie recipes.
    const food = chooseByTrigram(
      subject,
      candidates.filter((c) => c.source !== "mealie"),
    );
    if (!food) continue;
    const grams = ingredientGrams(parsed, food);
    if (grams === null || !(grams > 0) || grams > 20_000) continue;
    parts.push({ foodId: food.id, grams, name: parsed.name });
  }
  return { parts, total, matched: parts.length };
};
