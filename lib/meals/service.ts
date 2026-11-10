// Reading and editing meals and items (CONTRACT: lib/contracts/meals.ts). Every function takes the
// signed-in user's id and touches only that person's rows; an id of someone else's meal behaves
// exactly like an id that does not exist.
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { foods, mealItems, mealPhotos, meals, users } from "@/db/schema";
import type {
  ItemInput,
  ItemPatch,
  MealDto,
  MealItemDto,
  MealPatch,
  MealSummaryDto,
} from "@/lib/contracts/meals";
import { MEAL_SLOTS } from "@/lib/contracts/meals";
import {
  amountGrams,
  multiplyNutrients,
  nutrientsForAmount,
  sumNutrients,
  type NutrientMap,
} from "@/lib/contracts/nutrients";
import { rememberItem } from "@/lib/analysis/memory";
import { emojiFor } from "@/lib/food/emoji";
import { getFood } from "@/lib/food/search";

import { toItemDto, toMealDto, toSummaryDto } from "./dto";
import { isLocalDate, isValidTimeZone, localParts, slotFor, type MealWindows } from "./time";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

const ownMeal = (userId: string, mealId: string) =>
  and(eq(meals.id, mealId), eq(meals.userId, userId), isNull(meals.deletedAt));

/** The meals of one local day, oldest first, with their photos. */
export const listMealsForDay = async (
  userId: string,
  localDate: string,
  dbx: DbOrTx = defaultDb,
): Promise<MealSummaryDto[]> => {
  if (!isUuid(userId) || !isLocalDate(localDate)) return [];
  const rows = await dbx
    .select()
    .from(meals)
    .where(and(eq(meals.userId, userId), eq(meals.localDate, localDate), isNull(meals.deletedAt)))
    .orderBy(asc(meals.eatenAt), asc(meals.createdAt));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [photos, items] = await Promise.all([
    dbx.select().from(mealPhotos).where(inArray(mealPhotos.mealId, ids)),
    dbx
      .select({
        mealId: mealItems.mealId,
        position: mealItems.position,
        name: mealItems.name,
        localName: mealItems.localName,
        kind: mealItems.kind,
        emoji: mealItems.emoji,
        foodName: foods.nameEn,
      })
      .from(mealItems)
      .leftJoin(foods, eq(foods.id, mealItems.foodId))
      .where(and(inArray(mealItems.mealId, ids), eq(mealItems.userId, userId))),
  ]);
  return rows.map((row) =>
    toSummaryDto(
      row,
      photos.filter((p) => p.mealId === row.id),
      items.filter((i) => i.mealId === row.id),
    ),
  );
};

/** One meal with photos, items and questions, or null when it is not the person's. */
export const getMeal = async (
  userId: string,
  mealId: string,
  dbx: DbOrTx = defaultDb,
): Promise<MealDto | null> => {
  if (!isUuid(userId) || !isUuid(mealId)) return null;
  const row = (await dbx.select().from(meals).where(ownMeal(userId, mealId)).limit(1))[0];
  if (!row) return null;
  const [photos, items] = await Promise.all([
    dbx.select().from(mealPhotos).where(eq(mealPhotos.mealId, mealId)),
    dbx
      .select({ item: mealItems, foodName: foods.nameEn })
      .from(mealItems)
      .leftJoin(foods, eq(foods.id, mealItems.foodId))
      .where(and(eq(mealItems.mealId, mealId), eq(mealItems.userId, userId)))
      .orderBy(asc(mealItems.position)),
  ]);
  return toMealDto(
    row,
    photos,
    items.map((i) => ({ row: i.item, foodName: i.foodName })),
  );
};

/** Sums the items into meals.totals and returns the totals. */
export const recomputeMealTotals = async (mealId: string, dbx: DbOrTx = defaultDb) => {
  const items = await dbx
    .select({ nutrients: mealItems.nutrients })
    .from(mealItems)
    .where(eq(mealItems.mealId, mealId));
  const totals = sumNutrients(items.map((i) => i.nutrients ?? {}));
  await dbx.update(meals).set({ totals }).where(eq(meals.id, mealId));
  return totals;
};

const mealWindowsOf = async (userId: string, dbx: DbOrTx) =>
  (await dbx.select({ w: users.mealWindows }).from(users).where(eq(users.id, userId)).limit(1))[0]
    ?.w as MealWindows | undefined;

/** Changes time, slot, title or note. A new time moves the meal to its day; the slot follows
 * the time unless one is given. */
export const updateMeal = async (
  userId: string,
  mealId: string,
  patch: MealPatch,
  dbx: DbOrTx = defaultDb,
): Promise<MealDto | null> => {
  if (!isUuid(userId) || !isUuid(mealId)) return null;
  const row = (await dbx.select().from(meals).where(ownMeal(userId, mealId)).limit(1))[0];
  if (!row) return null;
  const set: Partial<typeof meals.$inferInsert> = {};
  if (patch.eatenAt !== undefined || patch.tz !== undefined) {
    const eatenAt = patch.eatenAt ? new Date(patch.eatenAt) : row.eatenAt;
    const tz = patch.tz ?? row.tz;
    if (Number.isNaN(eatenAt.getTime()) || !isValidTimeZone(tz)) throw new Error("Invalid time.");
    set.eatenAt = eatenAt;
    set.tz = tz;
    set.localDate = localParts(eatenAt, tz).date;
    if (!patch.slot) set.slot = slotFor(eatenAt, tz, await mealWindowsOf(userId, dbx));
  }
  if (patch.slot !== undefined) {
    if (!MEAL_SLOTS.includes(patch.slot)) throw new Error("Invalid slot.");
    set.slot = patch.slot;
  }
  if (patch.title !== undefined) set.title = patch.title?.trim().slice(0, 120) || null;
  if (patch.note !== undefined) set.note = patch.note?.trim().slice(0, 500) || null;
  if (Object.keys(set).length) await dbx.update(meals).set(set).where(ownMeal(userId, mealId));
  return getMeal(userId, mealId, dbx);
};

/** Soft delete; photos stay until the data clean-up removes them. */
export const deleteMeal = async (userId: string, mealId: string, dbx: DbOrTx = defaultDb) => {
  if (!isUuid(userId) || !isUuid(mealId)) return false;
  const done = await dbx
    .update(meals)
    .set({ deletedAt: new Date() })
    .where(ownMeal(userId, mealId))
    .returning({ id: meals.id });
  return done.length > 0;
};

/** "I ate this again": a copy of the meal's items at another time, ready at once. */
export const duplicateMeal = async (
  userId: string,
  mealId: string,
  at: { eatenAt: string; tz: string },
  dbx: DbOrTx = defaultDb,
): Promise<MealDto | null> => {
  const source = await getMeal(userId, mealId, dbx);
  if (!source) return null;
  const eatenAt = new Date(at.eatenAt);
  if (Number.isNaN(eatenAt.getTime()) || !isValidTimeZone(at.tz)) throw new Error("Invalid time.");
  const windows = await mealWindowsOf(userId, dbx);
  const newId = await dbx.transaction(async (tx) => {
    const [meal] = await tx
      .insert(meals)
      .values({
        userId,
        eatenAt,
        tz: at.tz,
        localDate: localParts(eatenAt, at.tz).date,
        slot: slotFor(eatenAt, at.tz, windows),
        title: source.title,
        note: source.note,
        status: "ready",
        source: "duplicate",
        totals: source.totals,
      })
      .returning({ id: meals.id });
    const originals = await tx.select().from(mealItems).where(eq(mealItems.mealId, mealId));
    if (originals.length)
      await tx.insert(mealItems).values(
        originals.map(({ id: _id, createdAt: _c, updatedAt: _u, ...item }) => ({
          ...item,
          mealId: meal!.id,
        })),
      );
    return meal!.id;
  });
  return getMeal(userId, newId, dbx);
};

// ---- Items ----

const ownItem = (userId: string, itemId: string) =>
  and(
    eq(mealItems.id, itemId),
    eq(mealItems.userId, userId),
    sql`exists (select 1 from meals m where m.id = ${mealItems.mealId} and m.deleted_at is null)`,
  );

const cleanNumber = (value: unknown, max: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max
    ? value
    : undefined;

const cleanNutrients = (map: NutrientMap | undefined) => {
  const out: NutrientMap = {};
  for (const [code, value] of Object.entries(map ?? {}))
    if (
      /^[a-z0-9_:]{1,40}$/.test(code) &&
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0
    )
      out[code] = value;
  return out;
};

/** Adds an item to the person's meal. Nutrients come from the food when one is given. */
export const addItem = async (
  userId: string,
  mealId: string,
  input: ItemInput,
  dbx: DbOrTx = defaultDb,
): Promise<MealItemDto | null> => {
  if (!isUuid(userId) || !isUuid(mealId)) return null;
  const meal = (
    await dbx.select({ id: meals.id }).from(meals).where(ownMeal(userId, mealId)).limit(1)
  )[0];
  if (!meal) return null;
  const food = input.foodId ? await getFood(input.foodId, userId, dbx) : null;
  if (input.foodId && !food) return null;
  const grams = cleanNumber(input.grams, 10_000) ?? food?.servingGrams ?? 100;
  const ml = cleanNumber(input.ml, 10_000) ?? null;
  const itemCount = cleanNumber(input.count, 100) || 1;
  const nutrients = food
    ? nutrientsForAmount(food.per100g, { grams, ml, count: itemCount }, food.densityGPerMl)
    : cleanNutrients(input.nutrients);
  const [{ next } = { next: 0 }] = await dbx
    .select({ next: sql<number>`coalesce(max(${mealItems.position}) + 1, 0)::int` })
    .from(mealItems)
    .where(eq(mealItems.mealId, mealId));
  const name = input.name.trim().slice(0, 120) || food?.nameEn || "Food";
  const localName = input.localName?.trim().slice(0, 120) || food?.nameFa || null;
  const kind = input.kind ?? "dish";
  const [row] = await dbx
    .insert(mealItems)
    .values({
      mealId,
      userId,
      position: next,
      name,
      localName,
      kind,
      emoji: emojiFor(name, kind, [food?.nameEn, localName]),
      foodId: food?.id ?? null,
      grams,
      ml,
      count: itemCount,
      portionText: input.portionText?.slice(0, 60) ?? null,
      edited: true,
      nutrients,
      nutrientSource: food ? "food" : "manual",
    })
    .returning();
  await recomputeMealTotals(mealId, dbx);
  // Cal learns from what the person adds and corrects (usual meals, lib/analysis/memory.ts).
  await rememberItem(userId, row!.id, dbx).catch(() => undefined);
  return toItemDto(row!, food?.nameEn ?? null);
};

/**
 * Changes an item and rescales its nutrients at once: from the food's values per 100 g when it
 * has a food, otherwise in proportion to the new weight. Marks the item edited.
 */
export const updateItem = async (
  userId: string,
  itemId: string,
  patch: ItemPatch,
  dbx: DbOrTx = defaultDb,
): Promise<MealItemDto | null> => {
  if (!isUuid(userId) || !isUuid(itemId)) return null;
  const row = (await dbx.select().from(mealItems).where(ownItem(userId, itemId)).limit(1))[0];
  if (!row) return null;

  const foodId = patch.foodId === undefined ? row.foodId : patch.foodId;
  const food = foodId ? await getFood(foodId, userId, dbx) : null;
  if (patch.foodId && !food) return null;

  const grams = cleanNumber(patch.grams, 10_000) ?? row.grams;
  const ml = patch.ml === null ? null : (cleanNumber(patch.ml, 10_000) ?? row.ml);
  const itemCount = cleanNumber(patch.count, 100) || row.count || 1;

  let nutrients: NutrientMap = row.nutrients ?? {};
  let nutrientSource = row.nutrientSource;
  let components = row.components ?? [];
  if (food) {
    nutrients = nutrientsForAmount(
      food.per100g,
      { grams, ml, count: itemCount },
      food.densityGPerMl,
    );
    nutrientSource = "food";
  } else if (patch.nutrients) {
    nutrients = cleanNutrients(patch.nutrients);
    nutrientSource = "manual";
  } else {
    const before = amountGrams({ grams: row.grams, ml: row.ml, count: row.count });
    const after = amountGrams({ grams, ml, count: itemCount });
    if (before > 0 && after !== before) {
      const factor = after / before;
      nutrients = multiplyNutrients(nutrients, factor);
      components = components.map((c) => ({
        ...c,
        grams: c.grams * factor,
        nutrients: c.nutrients ? multiplyNutrients(c.nutrients, factor) : c.nutrients,
      }));
    }
  }

  const name = patch.name?.trim().slice(0, 120) || row.name;
  // A new food gets the food's emoji, a new name its own; otherwise the item keeps its emoji.
  const newFood = (food?.id ?? null) !== row.foodId;
  const emoji =
    newFood && food
      ? emojiFor(food.nameEn, row.kind, [name, row.localName])
      : newFood || name !== row.name || !row.emoji
        ? emojiFor(name, row.kind, [food?.nameEn, row.localName])
        : row.emoji;
  const [updated] = await dbx
    .update(mealItems)
    .set({
      name,
      emoji,
      foodId: food?.id ?? null,
      grams,
      ml,
      count: itemCount,
      portionText:
        patch.portionText === undefined ? row.portionText : patch.portionText?.slice(0, 60) || null,
      nutrients,
      nutrientSource,
      components,
      edited: true,
    })
    .where(ownItem(userId, itemId))
    .returning();
  await recomputeMealTotals(row.mealId, dbx);
  await rememberItem(userId, itemId, dbx).catch(() => undefined);
  return toItemDto(updated!, food?.nameEn ?? null);
};

export const deleteItem = async (userId: string, itemId: string, dbx: DbOrTx = defaultDb) => {
  if (!isUuid(userId) || !isUuid(itemId)) return false;
  const done = await dbx
    .delete(mealItems)
    .where(ownItem(userId, itemId))
    .returning({ mealId: mealItems.mealId });
  if (done[0]) await recomputeMealTotals(done[0].mealId, dbx);
  return done.length > 0;
};
