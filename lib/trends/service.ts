// Loads a period of the person's meals and items for the Trends screen (lib/trends/compute.ts
// does the arithmetic).
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { foods, mealItems, meals } from "@/db/schema";
import { getWeightHistory } from "@/lib/integrations/day";
import { isUuid } from "@/lib/meals/service";
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
  const [mealRows, itemRows, { targets }, weight] = await Promise.all([
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
  });
};
