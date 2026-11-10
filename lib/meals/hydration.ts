// Water from drinks: the Today screen's water card adds up the volume of the day's meal items that
// are drinks (or plain water by name). Alcoholic drinks do not count. Plain functions, safe for
// client components.
import type { NutrientMap } from "@/lib/contracts/nutrients";
import type { Sex } from "@/lib/contracts/targets";

export type HydrationItem = {
  name: string;
  /** The matched food's name, when there is one. */
  foodName?: string | null;
  kind: string;
  ml: number | null;
  grams: number;
  count?: number | null;
  /** The item's own amounts (alcohol in g). */
  nutrients?: NutrientMap | null;
};

/**
 * Alcohol above this many grams per 100 g makes a drink alcoholic (about 0.5 % by volume, the
 * usual limit for "alcohol-free" beer and wine).
 */
export const ALCOHOL_LIMIT_PER_100G = 0.5;

const ALCOHOL_NAMES =
  /\bbeer\b|lager|\bales?\b|stout|\bipa\b|pilsner|\bcider\b|\bwine\b|champagne|prosecco|\bcava\b|sangria|whisky|whiskey|vodka|\bgin\b|\brum\b|tequila|\barak\b|araq|brandy|cognac|liqueur|liquor|cocktail|\bspirits?\b|\bsake\b|soju|\bmead\b|آبجو|شراب|عرق|ودکا/;
const ALCOHOL_FREE = /alcohol[- ]?free|non[- ]?alcoholic|\b0[.,]0 ?%|without alcohol|بدون الکل/;

const WATER_NAMES = /\bwater\b|^آب$|آب معدنی/;
const NOT_WATER = /melon|chestnut|cress|cracker|biscuit/;

/** Plain water by name ("Water", "Sparkling water"), not watermelon or water chestnuts. */
export const isWaterName = (name: string | null | undefined) => {
  const lower = (name ?? "").trim().toLowerCase();
  return !!lower && WATER_NAMES.test(lower) && !NOT_WATER.test(lower);
};

const countOf = (item: Pick<HydrationItem, "count">) =>
  item.count && item.count > 0 ? item.count : 1;

/** The item's volume in ml: its ml when set, else its grams read as ml; times its count. */
const volumeMl = (item: HydrationItem) => {
  const one = item.ml && item.ml > 0 ? item.ml : item.grams > 0 ? item.grams : 0;
  return one * countOf(item);
};

/** Beer, wine and spirits by name, or more than 0.5 g alcohol per 100 g. */
export const isAlcoholic = (item: HydrationItem) => {
  const names = `${item.name} ${item.foodName ?? ""}`.toLowerCase();
  if (ALCOHOL_FREE.test(names)) return false;
  const alcohol = item.nutrients?.alcohol;
  const total = volumeMl(item);
  if (typeof alcohol === "number" && total > 0 && (alcohol / total) * 100 > ALCOHOL_LIMIT_PER_100G)
    return true;
  return ALCOHOL_NAMES.test(names);
};

/** Whether the item is something to drink: kind drink, or water by name. */
export const isDrink = (item: Pick<HydrationItem, "kind" | "name" | "foodName">) =>
  item.kind === "drink" || isWaterName(item.name) || isWaterName(item.foodName);

/** Millilitres of water an item adds to the day: a non-alcoholic drink's volume, else 0. */
export const itemWaterMl = (item: HydrationItem) =>
  isDrink(item) && !isAlcoholic(item) ? Math.round(volumeMl(item)) : 0;

/** Millilitres of water from a list of items (one meal, or a whole day). */
export const totalWaterMl = (items: Iterable<HydrationItem>) => {
  let total = 0;
  for (const item of items) total += itemWaterMl(item);
  return total;
};

/**
 * The daily goal for water from drinks, in ml. EFSA's adequate intake of total water is 2.0 L a
 * day for women and 2.5 L for men, about 80 % of it from drinks and 20 % from food: 1.6 L and
 * 2.0 L from drinks (EFSA Panel on Dietetic Products, Nutrition and Allergies, "Scientific
 * Opinion on Dietary Reference Values for water", EFSA Journal 2010;8(3):1459). Without a sex in
 * the profile, the middle: 1.8 L.
 */
export const WATER_GOALS_ML = { female: 1600, male: 2000, unknown: 1800 } as const;

export const waterGoalMl = (sex: Sex | null | undefined) =>
  sex === "female"
    ? WATER_GOALS_ML.female
    : sex === "male"
      ? WATER_GOALS_ML.male
      : WATER_GOALS_ML.unknown;

/** The lowest and highest goal a person can set, in ml. */
export const WATER_GOAL_LIMITS_ML = { min: 250, max: 6000 } as const;

/** "1.25" for 1,250 ml (two decimals; "0" when nothing yet). */
export const litres = (ml: number) => (ml > 0 ? (ml / 1000).toFixed(2) : "0");

/** "2.0" for a 2,000 ml goal (one decimal, two when needed: "1.75"). */
export const goalLitres = (ml: number) =>
  (ml / 1000).toFixed(Number.isInteger(Math.round(ml) / 100) ? 1 : 2);
