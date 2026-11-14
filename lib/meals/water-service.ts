// The day's water entries and changes to water added on its own (CONTRACT: lib/contracts/water.ts).
// Every function takes the signed-in person's id and touches only their meals; someone else's meal
// behaves like one that does not exist.
import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { foods, mealItems, mealPhotos, meals } from "@/db/schema";
import { rememberItem } from "@/lib/analysis/memory";
import type { MealSource } from "@/lib/contracts/meals";
import { multiplyNutrients } from "@/lib/contracts/nutrients";
import type { WaterEntryDto, WaterPatch } from "@/lib/contracts/water";

import { isUuid, recomputeMealTotals } from "./service";
import { isLocalDate, isValidTimeZone, localParts } from "./time";
import { isWaterOnly, waterEntriesOf, waterEntriesOfDay, type WaterMeal } from "./water";

/** The person's meals that match `where` (not deleted), with their items and photo counts. */
const waterMeals = async (userId: string, where: SQL, dbx: DbOrTx): Promise<WaterMeal[]> => {
  const rows = await dbx
    .select()
    .from(meals)
    .where(and(eq(meals.userId, userId), isNull(meals.deletedAt), where))
    .orderBy(asc(meals.eatenAt), asc(meals.createdAt));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [photos, items] = await Promise.all([
    dbx
      .select({ mealId: mealPhotos.mealId, count: sql<number>`count(*)::int` })
      .from(mealPhotos)
      .where(inArray(mealPhotos.mealId, ids))
      .groupBy(mealPhotos.mealId),
    dbx
      .select({
        id: mealItems.id,
        mealId: mealItems.mealId,
        position: mealItems.position,
        name: mealItems.name,
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
      .where(and(inArray(mealItems.mealId, ids), eq(mealItems.userId, userId))),
  ]);
  return rows.map((row) => ({
    id: row.id,
    eatenAt: row.eatenAt.toISOString(),
    tz: row.tz,
    localDate: row.localDate,
    title: row.title,
    slot: row.slot,
    source: row.source as MealSource,
    photoCount: photos.find((p) => p.mealId === row.id)?.count ?? 0,
    items: items.filter((i) => i.mealId === row.id),
  }));
};

/**
 * The water of one local day, oldest first: water added on its own and the drinks inside meals
 * (alcohol not counted). Their sum is the day's water of the meal summaries.
 */
export const listWaterEntries = async (
  userId: string,
  localDate: string,
  dbx: DbOrTx = defaultDb,
): Promise<WaterEntryDto[]> => {
  if (!isUuid(userId) || !isLocalDate(localDate)) return [];
  return waterEntriesOfDay(await waterMeals(userId, eq(meals.localDate, localDate), dbx));
};

/** Water like the Water card writes it: its volume in ml, also as grams (1 g per ml). */
const volumeOf = (item: WaterMeal["items"][number]) =>
  (item.ml && item.ml > 0 ? item.ml : item.grams) * (item.count && item.count > 0 ? item.count : 1);

/**
 * Changes water added on its own: the amount (the item's ml and grams, its nutrients in
 * proportion and its water nutrient, one of it) and the meal's time (a time on another day moves
 * it there; the meal is named again for it). Null when the meal is not the person's;
 * "not-water" when it is more than water (that changes on its meal page).
 */
export const updateWaterEntry = async (
  userId: string,
  mealId: string,
  patch: WaterPatch,
  dbx: DbOrTx = defaultDb,
): Promise<WaterEntryDto | "not-water" | null> => {
  if (!isUuid(userId) || !isUuid(mealId)) return null;
  const meal = (await waterMeals(userId, eq(meals.id, mealId), dbx))[0];
  if (!meal) return null;
  if (!isWaterOnly(meal)) return "not-water";
  const item = meal.items[0]!;
  const eatenAt = patch.eatenAt ? new Date(patch.eatenAt) : new Date(meal.eatenAt);
  const tz = patch.tz ?? meal.tz;
  if (Number.isNaN(eatenAt.getTime()) || !isValidTimeZone(tz)) return null;

  await dbx.transaction(async (tx) => {
    if (patch.ml !== undefined) {
      const before = volumeOf(item);
      // Water weighs what it measures, unless its food said otherwise.
      const gramsPerMl = item.ml && item.ml > 0 && item.grams > 0 ? item.grams / item.ml : 1;
      await tx
        .update(mealItems)
        .set({
          ml: patch.ml,
          grams: Math.round(patch.ml * gramsPerMl * 10) / 10,
          count: 1,
          nutrients: {
            ...multiplyNutrients(item.nutrients ?? {}, before > 0 ? patch.ml / before : 1),
            water: patch.ml,
          },
          edited: true,
        })
        .where(and(eq(mealItems.id, item.id), eq(mealItems.userId, userId)));
    }
    if (patch.eatenAt !== undefined || patch.tz !== undefined)
      await tx
        .update(meals)
        .set({ eatenAt, tz, localDate: localParts(eatenAt, tz).date })
        .where(and(eq(meals.id, mealId), eq(meals.userId, userId)));
    // The totals follow the item, and the meal's name its time.
    await recomputeMealTotals(mealId, tx);
  });
  // Kal learns the usual amount from hand edits, as for any item (lib/analysis/memory.ts).
  if (patch.ml !== undefined) await rememberItem(userId, item.id, dbx).catch(() => undefined);

  const changed = (await waterMeals(userId, eq(meals.id, mealId), dbx))[0];
  return changed ? (waterEntriesOf(changed)[0] ?? null) : null;
};
