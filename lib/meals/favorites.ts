// Favorite meals: a meal is a favorite while meals.favorite_at is set (PATCH /api/meals/:id
// {favorite}). "Log a favorite again" copies the meal as it is at that moment (the "I ate this
// again" copy, lib/meals/service.ts duplicateMeal), so a favorite whose items were edited later is
// logged with the edits. Most recently used favorites come first: the last time one was logged
// again, else when it was starred. Scoped by the signed-in person's id.
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { foods, mealItems, meals } from "@/db/schema";
import { MEAL_SLOT_LABELS, type FavoriteDto, type MealDto } from "@/lib/contracts/meals";

import { toSummaryDto } from "./dto";
import { duplicateMeal, isUuid } from "./service";

/** The plate, for a favorite without items. */
const PLATE = "🍽️";

/** The person's favorites, most recently used first; at most `limit`. */
export const listFavorites = async (
  userId: string,
  limit = 50,
  dbx: DbOrTx = defaultDb,
): Promise<FavoriteDto[]> => {
  if (!isUuid(userId)) return [];
  const rows = await dbx
    .select()
    .from(meals)
    .where(and(eq(meals.userId, userId), isNotNull(meals.favoriteAt), isNull(meals.deletedAt)))
    .orderBy(
      desc(sql`coalesce(${meals.favoriteUsedAt}, ${meals.favoriteAt})`),
      asc(meals.createdAt),
    )
    .limit(Math.max(1, Math.min(200, limit)));
  if (!rows.length) return [];
  const items = await dbx
    .select({
      mealId: mealItems.mealId,
      position: mealItems.position,
      name: mealItems.name,
      localName: mealItems.localName,
      kind: mealItems.kind,
      emoji: mealItems.emoji,
      ml: mealItems.ml,
      grams: mealItems.grams,
      count: mealItems.count,
      nutrients: mealItems.nutrients,
      foodName: foods.nameEn,
    })
    .from(mealItems)
    .leftJoin(foods, eq(foods.id, mealItems.foodId))
    .where(
      and(
        inArray(
          mealItems.mealId,
          rows.map((r) => r.id),
        ),
        eq(mealItems.userId, userId),
      ),
    );
  return rows.map((row) => {
    const summary = toSummaryDto(
      row,
      [],
      items.filter((i) => i.mealId === row.id),
    );
    return {
      mealId: row.id,
      title: row.title ?? MEAL_SLOT_LABELS[row.slot],
      emoji: summary.foods[0]?.emoji ?? PLATE,
      kcal: typeof row.totals?.energy === "number" ? row.totals.energy : null,
      slot: row.slot,
      foods: summary.foods,
      lastUsedAt: row.favoriteUsedAt?.toISOString() ?? null,
      favoriteAt: (row.favoriteAt ?? row.createdAt).toISOString(),
    };
  });
};

/**
 * Logs a favorite again at the given time: a ready copy of the meal as it is now. Null when the
 * meal is not one of the person's favorites.
 */
export const logFavorite = async (
  userId: string,
  mealId: string,
  at: { eatenAt: string; tz: string },
  dbx: DbOrTx = defaultDb,
): Promise<MealDto | null> => {
  if (!isUuid(userId) || !isUuid(mealId)) return null;
  const favorite = (
    await dbx
      .select({ id: meals.id })
      .from(meals)
      .where(
        and(
          eq(meals.id, mealId),
          eq(meals.userId, userId),
          isNotNull(meals.favoriteAt),
          isNull(meals.deletedAt),
        ),
      )
      .limit(1)
  )[0];
  if (!favorite) return null;
  const copy = await duplicateMeal(userId, mealId, at, dbx);
  if (copy)
    await dbx
      .update(meals)
      .set({ favoriteUsedAt: new Date() })
      .where(and(eq(meals.id, mealId), eq(meals.userId, userId)));
  return copy;
};
