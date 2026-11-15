// Loads one calendar year of the person's days for the Trends year card (lib/trends/year.ts).
// The day totals are the meals' totals added up per local date, as Today and Trends add them
// (countedMeal: deleted meals and failed ones without items left out); only the four macros and
// the chosen nutrient are read from each meal's totals. Water comes from drinks as on Today's Water
// card, steps and the activity part of the water goal from Move. Nothing is sent for days without
// meals, water or steps. Scoped by user id; values are never logged.
import { and, between, eq, ilike, like, or, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { foods, mealItems, meals } from "@/db/schema";
import type { NutrientCode, NutrientMap } from "@/lib/contracts/nutrients";
import { itemWaterMl } from "@/lib/meals/hydration";
import { isUuid } from "@/lib/meals/service";
import { isWaterOnly } from "@/lib/meals/water";
import { byDay, daySteps, sweatMinutes } from "@/lib/move/score";
import { activitiesBetween } from "@/lib/move/service";
import { dayWaterGoalMl } from "@/lib/move/water";
import { getTargets } from "@/lib/targets/service";

import { countedMeal } from "./service";
import {
  clampYear,
  DEFAULT_YEAR_METRIC,
  isYearMetric,
  lastDayOf,
  yearStart,
  type YearData,
  type YearDay,
} from "./year";

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Adds a meal's value to a day's sum; null stays null until a meal has a value. */
const plus = (sum: number | null, value: unknown) => (finite(value) ? (sum ?? 0) + value : sum);

/** The year of the person's first meal that counts, or null without one. */
export const firstMealYear = async (userId: string, dbx: DbOrTx = defaultDb) => {
  if (!isUuid(userId)) return null;
  const [row] = await dbx
    .select({ first: sql<string | null>`min(${meals.localDate})::text` })
    .from(meals)
    .where(and(eq(meals.userId, userId), countedMeal()));
  return row?.first ? Number(row.first.slice(0, 4)) : null;
};

/**
 * The year card's data. `year` is the one asked for (the address's ?year=), kept between the year
 * of the first meal and the current one; `metric` is a nutrient code ("water": from drinks).
 */
export const getYear = async (
  userId: string,
  input: { year?: unknown; metric?: unknown; today: string },
  dbx: DbOrTx = defaultDb,
): Promise<YearData> => {
  const currentYear = Number(input.today.slice(0, 4));
  const metric: NutrientCode = isYearMetric(input.metric) ? input.metric : DEFAULT_YEAR_METRIC;
  const [first, { targets, hydration }] = await Promise.all([
    firstMealYear(userId, dbx),
    getTargets(userId, dbx),
  ]);
  const firstYear = Math.min(first ?? currentYear, currentYear);
  const year = clampYear(input.year ?? String(currentYear), firstYear, currentYear);
  const start = yearStart(year);
  const end = lastDayOf(year, input.today);
  const base = {
    year,
    metric,
    today: input.today,
    firstYear,
    targets,
    waterGoalMl: hydration.goalMl,
    currentTargets: true as const,
  };
  if (!isUuid(userId) || start > end) return { ...base, days: [] };

  const pick = (code: string) => sql<unknown>`${meals.totals} -> ${code}::text`;
  const ownDays = and(
    eq(meals.userId, userId),
    countedMeal(),
    between(meals.localDate, start, end),
  );
  // Water added on its own (a manual or copied meal with one plain water and no photo) is not a
  // meal of the day; only these can be one, so only their items and photos are counted.
  const maybeWater = sql`${meals.source} in ('manual', 'duplicate')`;
  const [mealRows, drinkRows, activityRows] = await Promise.all([
    dbx
      .select({
        id: meals.id,
        localDate: meals.localDate,
        source: meals.source,
        energy: pick("energy"),
        protein: pick("protein"),
        carbs: pick("carbs"),
        fat: pick("fat"),
        value: metric === "water" ? sql<null>`null` : pick(metric),
        // Written out: Drizzle leaves the table off column names in a one-table select.
        items: sql<number>`case when ${maybeWater} then (select count(*)::int from meal_items i where i.meal_id = meals.id) else 0 end`,
        photos: sql<number>`case when ${maybeWater} then (select count(*)::int from meal_photos p where p.meal_id = meals.id) else 0 end`,
      })
      .from(meals)
      .where(ownDays),
    // The items that can add water (lib/meals/hydration.ts decides): drinks, and water by name.
    dbx
      .select({
        mealId: mealItems.mealId,
        localDate: meals.localDate,
        name: mealItems.name,
        kind: mealItems.kind,
        ml: mealItems.ml,
        grams: mealItems.grams,
        count: mealItems.count,
        energy: sql<unknown>`${mealItems.nutrients} -> 'energy'`,
        alcohol: sql<unknown>`${mealItems.nutrients} -> 'alcohol'`,
        foodName: foods.nameEn,
      })
      .from(mealItems)
      .innerJoin(meals, eq(meals.id, mealItems.mealId))
      .leftJoin(foods, eq(foods.id, mealItems.foodId))
      .where(
        and(
          ownDays,
          eq(mealItems.userId, userId),
          or(
            eq(mealItems.kind, "drink"),
            ilike(mealItems.name, "%water%"),
            ilike(foods.nameEn, "%water%"),
            like(mealItems.name, "%آب%"),
            like(foods.nameEn, "%آب%"),
          ),
        ),
      ),
    activitiesBetween(userId, start, end, dbx),
  ]);

  const drinks = drinkRows.map((row) => {
    const nutrients: NutrientMap = {};
    if (finite(row.energy)) nutrients.energy = row.energy;
    if (finite(row.alcohol)) nutrients.alcohol = row.alcohol;
    return { ...row, nutrients };
  });
  const drinksOf = new Map<string, typeof drinks>();
  for (const drink of drinks)
    drinksOf.set(drink.mealId, [...(drinksOf.get(drink.mealId) ?? []), drink]);

  const days = new Map<string, YearDay>();
  const dayOf = (date: string) => {
    let day = days.get(date);
    if (!day) {
      day = {
        date,
        meals: 0,
        value: null,
        energy: null,
        protein: null,
        carbs: null,
        fat: null,
        waterMl: 0,
        waterGoalMl: hydration.goalMl,
        steps: 0,
      };
      days.set(date, day);
    }
    return day;
  };

  for (const row of mealRows) {
    const day = dayOf(row.localDate);
    const own = drinksOf.get(row.id) ?? [];
    const waterOnly =
      row.items === 1 &&
      own.length === 1 &&
      isWaterOnly({
        source: row.source,
        photoCount: row.photos,
        items: own.map((drink) => ({ ...drink, id: drink.mealId, position: 0, emoji: null })),
      });
    if (!waterOnly) day.meals += 1;
    day.energy = plus(day.energy, row.energy);
    day.protein = plus(day.protein, row.protein);
    day.carbs = plus(day.carbs, row.carbs);
    day.fat = plus(day.fat, row.fat);
    day.value = plus(day.value, row.value);
  }
  for (const drink of drinks) {
    const ml = itemWaterMl(drink);
    if (ml > 0) dayOf(drink.localDate).waterMl += ml;
  }
  for (const [date, list] of byDay(activityRows)) {
    const steps = daySteps(list);
    const goal = dayWaterGoalMl(hydration.goalMl, sweatMinutes(list));
    if (!steps && goal === hydration.goalMl && !days.has(date)) continue;
    const day = dayOf(date);
    day.steps = steps;
    day.waterGoalMl = goal;
  }

  return { ...base, days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)) };
};
