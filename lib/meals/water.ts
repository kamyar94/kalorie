// The day's water entries (CONTRACT: lib/contracts/water.ts) from meals and their items: which
// meals are water added on its own, the rows of the Water card, their names and total, and the
// check of a change sent by the water sheet. Plain functions, safe for client components (the
// card adds an entry from the meal a "+ Glass" returns) and unit tests.
import { emojiFor } from "@/lib/food/emoji";
import {
  MEAL_SLOT_LABELS,
  type MealDto,
  type MealSlot,
  type MealSource,
} from "@/lib/contracts/meals";
import { WATER_LIMITS, type WaterEntryDto, type WaterPatch } from "@/lib/contracts/water";

import { isAlcoholic, isWaterName, itemWaterMl, type HydrationItem } from "./hydration";
import { localParts } from "./time";

export type WaterItem = HydrationItem & { id: string; position: number; emoji: string | null };

/** What the entries need of a meal: its time, name, source, photos and items. */
export type WaterMeal = {
  id: string;
  eatenAt: string;
  tz: string;
  localDate: string;
  title: string | null;
  slot: MealSlot;
  source: MealSource;
  photoCount: number;
  items: WaterItem[];
};

/** Plain water by name, without energy or alcohol, that adds water to the day. */
const isPlainWater = (item: HydrationItem) =>
  (isWaterName(item.name) || isWaterName(item.foodName)) &&
  !isAlcoholic(item) &&
  (item.nutrients?.energy ?? 0) < 1 &&
  itemWaterMl(item) > 0;

/**
 * Water added on its own: a meal logged by hand (or copied from one) with no photo and one item,
 * plain water. The Water card's "+ Glass" and "+ Bottle" make these; the water sheet changes them.
 */
export const isWaterOnly = (meal: Pick<WaterMeal, "source" | "photoCount" | "items">) =>
  (meal.source === "manual" || meal.source === "duplicate") &&
  meal.photoCount === 0 &&
  meal.items.length === 1 &&
  isPlainWater(meal.items[0]!);

/** The water entries of one meal: its drinks that add water, in item order. */
export const waterEntriesOf = (meal: WaterMeal): WaterEntryDto[] => {
  const standalone = isWaterOnly(meal);
  const { time } = localParts(new Date(meal.eatenAt), meal.tz);
  return [...meal.items]
    .sort((a, b) => a.position - b.position)
    .flatMap((item) => {
      const waterMl = itemWaterMl(item);
      if (waterMl <= 0) return [];
      return [
        {
          itemId: item.id,
          mealId: meal.id,
          eatenAt: new Date(meal.eatenAt).toISOString(),
          tz: meal.tz,
          localDate: meal.localDate,
          localTime: time,
          standalone,
          name: item.name,
          emoji: item.emoji ?? emojiFor(item.name, item.kind, [item.foodName]),
          waterMl,
          mealTitle: standalone ? null : (meal.title ?? MEAL_SLOT_LABELS[meal.slot]),
        },
      ];
    });
};

/** Entries oldest first; drinks of the same meal keep their item order. */
export const sortWaterEntries = (entries: WaterEntryDto[]) =>
  [...entries].sort((a, b) => Date.parse(a.eatenAt) - Date.parse(b.eatenAt));

/** The entries of a day's meals, oldest first. */
export const waterEntriesOfDay = (meals: WaterMeal[]) =>
  sortWaterEntries(meals.flatMap(waterEntriesOf));

/** Millilitres of water of a list of entries (the card's total). */
export const waterTotalMl = (entries: Pick<WaterEntryDto, "waterMl">[]) =>
  entries.reduce((sum, entry) => sum + entry.waterMl, 0);

/**
 * A row's name: water added on its own reads Glass (250 ml) or Bottle (500 ml), like the card's
 * buttons, else Water; a drink inside a meal keeps its own name.
 */
export const waterEntryName = (entry: Pick<WaterEntryDto, "standalone" | "name" | "waterMl">) =>
  !entry.standalone || entry.name.trim().toLowerCase() !== "water"
    ? entry.name
    : entry.waterMl === 250
      ? "Glass"
      : entry.waterMl === 500
        ? "Bottle"
        : "Water";

/** "in Lunch": where a drink inside a meal is, unless the meal is named after the drink. */
export const waterEntryPlace = (entry: Pick<WaterEntryDto, "name" | "mealTitle">) =>
  entry.mealTitle && entry.mealTitle.trim().toLowerCase() !== entry.name.trim().toLowerCase()
    ? `in ${entry.mealTitle}`
    : null;

/** A meal as the routes return it, for its entries (the card adds new water at once). */
export const waterMealOf = (meal: MealDto): WaterMeal => ({
  id: meal.id,
  eatenAt: meal.eatenAt,
  tz: meal.tz,
  localDate: meal.localDate,
  title: meal.title,
  slot: meal.slot,
  source: meal.source,
  photoCount: meal.photos.length,
  items: meal.items.map((item) => ({
    id: item.id,
    position: item.position,
    name: item.name,
    foodName: item.foodName,
    kind: item.kind,
    emoji: item.emoji,
    ml: item.ml,
    grams: item.grams,
    count: item.count,
    nutrients: item.nutrients,
  })),
});

/** A whole number of millilitres within WATER_LIMITS, else null. */
export const cleanWaterMl = (value: unknown) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.round(value) >= WATER_LIMITS.minMl &&
  Math.round(value) <= WATER_LIMITS.maxMl
    ? Math.round(value)
    : null;

export const WATER_AMOUNT_ERROR = `Give an amount from ${WATER_LIMITS.minMl} to ${WATER_LIMITS.maxMl.toLocaleString("en-US")} ml.`;

/**
 * The water sheet's change: an amount (WATER_LIMITS) and a time with its zone (the past year,
 * not the future: a few minutes of clock skew allowed). A field sent but not valid is an error,
 * and so is a change of nothing.
 */
export const parseWaterPatch = (
  body: Record<string, unknown>,
  now = Date.now(),
): WaterPatch | { error: string } => {
  const patch: WaterPatch = {};
  if (body.ml !== undefined) {
    const ml = cleanWaterMl(body.ml);
    if (ml === null) return { error: WATER_AMOUNT_ERROR };
    patch.ml = ml;
  }
  if (body.eatenAt !== undefined) {
    const at = typeof body.eatenAt === "string" ? new Date(body.eatenAt) : null;
    if (
      !at ||
      Number.isNaN(at.getTime()) ||
      at.getTime() > now + 10 * 60_000 ||
      at.getTime() < now - 366 * 86_400_000
    )
      return { error: "Pick a time in the past year." };
    patch.eatenAt = at.toISOString();
  }
  if (typeof body.tz === "string") patch.tz = body.tz.slice(0, 64);
  if (patch.ml === undefined && patch.eatenAt === undefined)
    return { error: "Send a new amount or a new time." };
  return patch;
};
