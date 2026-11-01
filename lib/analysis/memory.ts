// What Cal learns from corrections (docs/DESIGN.md section 1, principle 4): food_memory keeps, per
// person and normalised item name, the food it turned out to be, the usual portion and a snapshot
// of the corrected item. The analysis shows the top 30 as "usual meals" to the vision model,
// matches items to them, and the matching step tries a remembered food first.
//
// rememberItem is called after a person edits or adds an item (lib/meals/service.ts). Repeated
// edits of the same meal count once.
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { foodMemory, mealItems, meals, type ItemComponentRow } from "@/db/schema";
import type { ItemKind, NutrientSource } from "@/lib/contracts/meals";
import type { NutrientMap } from "@/lib/contracts/nutrients";
import { normalizeFoodText } from "@/lib/food/normalize";

import { hasEnergy } from "./nutrients";

export const USUAL_MEALS_LIMIT = 30;

/** food_memory.snapshot: the corrected item, nutrients for its grams. */
export type MemorySnapshot = {
  name: string;
  localName: string | null;
  kind: ItemKind;
  foodId: string | null;
  grams: number;
  ml: number | null;
  nutrients: NutrientMap;
  nutrientSource: NutrientSource;
  components: ItemComponentRow[];
  /** The meal the last correction came from, and the usual portion before it. */
  mealId: string;
  baseGrams: number | null;
  baseCount: number;
};

export type UsualMeal = {
  id: string;
  nameKey: string;
  name: string;
  localName: string | null;
  kind: ItemKind | null;
  foodId: string | null;
  typicalGrams: number | null;
  count: number;
  snapshot: MemorySnapshot | null;
};

type MemoryRow = typeof foodMemory.$inferSelect;

const toUsual = (row: MemoryRow): UsualMeal => {
  const snapshot = (row.snapshot ?? null) as MemorySnapshot | null;
  return {
    id: String(row.id),
    nameKey: row.nameKey,
    name: row.displayName,
    localName: snapshot?.localName ?? null,
    kind: snapshot?.kind ?? null,
    foodId: row.foodId,
    typicalGrams: row.typicalGrams,
    count: row.count,
    snapshot,
  };
};

export const memoryKey = (name: string) => normalizeFoodText(name).slice(0, 120);

/** The person's usual meals: most often corrected first, then most recent. */
export const getUsualMeals = async (
  userId: string,
  limit = USUAL_MEALS_LIMIT,
  dbx: DbOrTx = defaultDb,
): Promise<UsualMeal[]> => {
  const rows = await dbx
    .select()
    .from(foodMemory)
    .where(eq(foodMemory.userId, userId))
    .orderBy(desc(foodMemory.count), desc(foodMemory.lastUsedAt), desc(foodMemory.id))
    .limit(limit);
  return rows.map(toUsual);
};

/** Memory rows for normalised names, by name key. */
export const findMemory = async (
  userId: string,
  names: string[],
  dbx: DbOrTx = defaultDb,
): Promise<Map<string, UsualMeal>> => {
  const keys = [...new Set(names.map(memoryKey).filter(Boolean))];
  if (!keys.length) return new Map();
  const rows = await dbx
    .select()
    .from(foodMemory)
    .where(and(eq(foodMemory.userId, userId), inArray(foodMemory.nameKey, keys)));
  return new Map(rows.map((row) => [row.nameKey, toUsual(row)]));
};

/** Marks usual meals as used again (an analysis linked an item to them). */
export const touchUsualMeals = async (userId: string, ids: string[], dbx: DbOrTx = defaultDb) => {
  const numeric = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!numeric.length) return;
  await dbx
    .update(foodMemory)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(foodMemory.userId, userId), inArray(foodMemory.id, numeric)));
};

/** Weighted mean of the usual portion; older meals weigh at most nine times one new meal. */
const nextTypical = (base: number | null, baseCount: number, grams: number) => {
  if (base === null || baseCount <= 0) return grams;
  const weight = Math.min(baseCount, 9);
  return Math.round(((base * weight + grams) / (weight + 1)) * 10) / 10;
};

/**
 * Learns from one of the person's items after they edited or added it. Items without known energy
 * are skipped. Returns the memory id, or null when nothing was stored.
 */
export const rememberItem = async (
  userId: string,
  itemId: string,
  dbx: DbOrTx = defaultDb,
): Promise<string | null> => {
  const item = (
    await dbx
      .select({ item: mealItems })
      .from(mealItems)
      .innerJoin(meals, eq(meals.id, mealItems.mealId))
      .where(and(eq(mealItems.id, itemId), eq(mealItems.userId, userId), isNull(meals.deletedAt)))
      .limit(1)
  )[0]?.item;
  if (!item || !hasEnergy(item.nutrients)) return null;
  const nameKey = memoryKey(item.name);
  if (!nameKey) return null;
  const grams = Math.max(0, item.grams * (item.count || 1));
  if (grams <= 0) return null;

  const existing = (
    await dbx
      .select()
      .from(foodMemory)
      .where(and(eq(foodMemory.userId, userId), eq(foodMemory.nameKey, nameKey)))
      .limit(1)
  )[0];
  const previous = (existing?.snapshot ?? null) as MemorySnapshot | null;
  const sameMeal = !!existing && previous?.mealId === item.mealId;
  const baseGrams = sameMeal ? (previous?.baseGrams ?? null) : (existing?.typicalGrams ?? null);
  const baseCount = sameMeal ? (previous?.baseCount ?? 0) : (existing?.count ?? 0);

  const snapshot: MemorySnapshot = {
    name: item.name,
    localName: item.localName,
    kind: item.kind,
    foodId: item.foodId,
    grams,
    ml: item.ml,
    nutrients: item.nutrients,
    nutrientSource: item.nutrientSource,
    components: item.components ?? [],
    mealId: item.mealId,
    baseGrams,
    baseCount,
  };
  const values = {
    displayName: item.name,
    foodId: item.foodId,
    typicalGrams: nextTypical(baseGrams, baseCount, grams),
    count: baseCount + 1,
    snapshot,
    lastUsedAt: new Date(),
  };
  const [row] = await dbx
    .insert(foodMemory)
    .values({ userId, nameKey, ...values })
    .onConflictDoUpdate({ target: [foodMemory.userId, foodMemory.nameKey], set: values })
    .returning({ id: foodMemory.id });
  return row ? String(row.id) : null;
};
