// The person's recent and frequent foods for the Add screen, from their own meal items (items
// with a matched food only). Each comes with the amount used last time, so adding it again is one
// tap.
import { and, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { mealItems, meals } from "@/db/schema";
import type { FoodResult } from "@/lib/contracts/food-search";
import { getFoodsByIds } from "@/lib/food/search";

import { isUuid } from "./service";

export type UsedFood = {
  food: FoodResult;
  /** Grams of one count the last time it was logged. */
  lastGrams: number;
  lastPortionText: string | null;
  /** Times logged in the period (frequent list) or overall (recent list). */
  uses: number;
};

const usedFoods = async (
  userId: string,
  order: "recent" | "frequent",
  limit: number,
  dbx: DbOrTx,
): Promise<UsedFood[]> => {
  if (!isUuid(userId)) return [];
  const since = new Date(Date.now() - 90 * 86_400_000);
  const lastAt = sql<Date>`max(${mealItems.createdAt})`;
  const uses = sql<number>`count(*)::int`;
  const rows = await dbx
    .select({
      foodId: mealItems.foodId,
      uses,
      lastAt,
      // The latest amount and portion text, picked by time.
      lastGrams: sql<number>`(array_agg(${mealItems.grams} order by ${mealItems.createdAt} desc))[1]`,
      lastPortion: sql<
        string | null
      >`(array_agg(${mealItems.portionText} order by ${mealItems.createdAt} desc))[1]`,
    })
    .from(mealItems)
    .innerJoin(meals, eq(meals.id, mealItems.mealId))
    .where(
      and(
        eq(mealItems.userId, userId),
        isNotNull(mealItems.foodId),
        isNull(meals.deletedAt),
        order === "frequent" ? gte(mealItems.createdAt, since) : undefined,
      ),
    )
    .groupBy(mealItems.foodId)
    .orderBy(order === "recent" ? desc(lastAt) : desc(uses), desc(lastAt))
    .limit(Math.min(Math.max(1, limit), 50));
  const ids = rows.map((r) => r.foodId!).filter(Boolean);
  const foods = await getFoodsByIds(ids, userId, dbx);
  return rows.flatMap((row) => {
    const food = foods.get(row.foodId!);
    return food
      ? [
          {
            food,
            lastGrams: Number(row.lastGrams) || food.servingGrams || 100,
            lastPortionText: row.lastPortion ?? null,
            uses: Number(row.uses),
          },
        ]
      : [];
  });
};

/** Foods logged most recently, newest first. */
export const recentFoods = (userId: string, limit = 12, dbx: DbOrTx = defaultDb) =>
  usedFoods(userId, "recent", limit, dbx);

/** Foods logged most often in the last 90 days. */
export const frequentFoods = (userId: string, limit = 12, dbx: DbOrTx = defaultDb) =>
  usedFoods(userId, "frequent", limit, dbx);
