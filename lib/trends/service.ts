// Loads a period of the person's meals, items and activities for the Trends screen
// (lib/trends/compute.ts and lib/trends/activity.ts do the arithmetic).
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { foods, mealItems, meals } from "@/db/schema";
import { dayTotalsBetween } from "@/lib/health-connect/day-totals";
import { getWeightHistory } from "@/lib/integrations/day";
import { isUuid } from "@/lib/meals/service";
import { shiftLocalDate } from "@/lib/meals/time";
import { getMoveGoals } from "@/lib/move/goals";
import { activitiesBetween } from "@/lib/move/service";
import { weekStart } from "@/lib/move/week";
import { getTargets } from "@/lib/targets/service";

import { computeTrends, rangeDates, type TrendRange, type TrendsData } from "./compute";

/**
 * The meals a period counts: not deleted, and not an analysis that failed with nothing in it (a
 * photo that was not food, or no AI key yet). A failed analysis again of a meal that kept its
 * items still counts, as on Today.
 */
export const countedMeal = () =>
  and(
    isNull(meals.deletedAt),
    sql`not (${meals.status} = 'failed' and ${meals.totals} = '{}'::jsonb)`,
  );

export const getTrends = async (
  userId: string,
  range: TrendRange,
  end: string,
  dbx: DbOrTx = defaultDb,
): Promise<TrendsData> => {
  const dates = rangeDates(range, end);
  const start = dates[0]!;
  const inPeriod = isUuid(userId)
    ? and(
        eq(meals.userId, userId),
        countedMeal(),
        gte(meals.localDate, start),
        lte(meals.localDate, end),
      )
    : undefined;
  // A day's view also reads the rest of its Monday-to-Sunday week, for the WHO line.
  const monday = weekStart(end);
  const [mealRows, itemRows, { targets }, weight, activityRows, dayTotals, goals] =
    await Promise.all([
      inPeriod
        ? dbx
            .select({
              localDate: meals.localDate,
              eatenAt: meals.eatenAt,
              tz: meals.tz,
              slot: meals.slot,
              totals: meals.totals,
            })
            .from(meals)
            .where(inPeriod)
        : [],
      inPeriod
        ? dbx
            .select({
              name: mealItems.name,
              foodId: mealItems.foodId,
              foodName: foods.nameEn,
              nutrients: mealItems.nutrients,
            })
            .from(mealItems)
            .innerJoin(meals, eq(meals.id, mealItems.mealId))
            .leftJoin(foods, eq(foods.id, mealItems.foodId))
            .where(and(inPeriod, eq(mealItems.userId, userId)))
        : [],
      getTargets(userId, dbx),
      getWeightHistory(userId, start, end, dbx),
      range === "day"
        ? activitiesBetween(userId, monday, shiftLocalDate(monday, 6), dbx)
        : activitiesBetween(userId, start, end, dbx),
      dayTotalsBetween(userId, start, end, dbx),
      getMoveGoals(userId, dbx),
    ]);
  return computeTrends({
    range,
    end,
    meals: mealRows,
    items: itemRows.map((r) => ({
      name: r.name,
      foodId: r.foodId,
      foodName: r.foodName,
      energy: r.nutrients?.energy ?? 0,
    })),
    targets,
    weight,
    activities: activityRows,
    dayTotals,
    goals,
  });
};
