// What Cal learns from corrections (CONTRACT: lib/contracts/foods.ts; table food_memory): for a
// normalised item name, the food the person chose, typical grams, how often and when last.
// The app itself writes and reads food_memory through lib/analysis/memory.ts (item edits and the
// analysis) and lists recent foods with lib/meals/recent-foods.ts; nothing in the app calls this
// module today. Tests use it to set up memory rows, and search (lib/food/search.ts) reads the same
// table to rank remembered and logged foods first.
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { foodMemory, foods } from "@/db/schema";
import type { FoodCorrection, FoodMemoryEntry, RecentFood } from "@/lib/contracts/foods";

import { normalizeFoodText } from "./normalize";
import { getFoodsByIds, isFoodId } from "./search";

type MemoryRow = typeof foodMemory.$inferSelect;

/** The key an item name is remembered under. */
export const memoryKey = (name: string) => normalizeFoodText(name ?? "").slice(0, 120);

/**
 * The new typical weight: a running mean that weighs the last five uses, so a portion that
 * changes over time is followed.
 */
export const nextTypicalGrams = (previous: number | null, count: number, grams: number | null) => {
  if (grams === null || !Number.isFinite(grams) || grams <= 0) return previous;
  if (previous === null || count <= 0) return Math.round(grams * 10) / 10;
  const weight = Math.min(count, 4);
  return Math.round(((previous * weight + grams) / (weight + 1)) * 10) / 10;
};

const toEntry = (row: MemoryRow, foodName: string | null): FoodMemoryEntry => ({
  id: row.id,
  nameKey: row.nameKey,
  displayName: row.displayName,
  foodId: row.foodId,
  foodName,
  typicalGrams: row.typicalGrams,
  count: row.count,
  lastUsedAt: row.lastUsedAt.toISOString(),
  snapshot: row.snapshot ?? null,
});

/** Food names for entries, only for foods the person can still see. */
const withFoodNames = async (userId: string, rows: MemoryRow[], dbx: DbOrTx) => {
  const ids = [...new Set(rows.map((r) => r.foodId).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (ids.length) {
    const visible = await dbx
      .select({ id: foods.id, nameEn: foods.nameEn })
      .from(foods)
      .where(and(inArray(foods.id, ids), or(isNull(foods.ownerId), eq(foods.ownerId, userId))));
    for (const food of visible) names.set(food.id, food.nameEn);
  }
  return rows.map((row) => toEntry(row, row.foodId ? (names.get(row.foodId) ?? null) : null));
};

/**
 * Records one correction under the item's name (and its Persian name, when given). The same
 * food again: count + 1, typical grams follow. Another food: the memory starts over with it.
 * Returns the entry for the name, or null when the food is not visible to the person.
 */
export const rememberFood = async (
  userId: string,
  correction: FoodCorrection,
  dbx: DbOrTx = defaultDb,
): Promise<FoodMemoryEntry | null> => {
  if (!isFoodId(correction.foodId)) return null;
  const visible = await getFoodsByIds([correction.foodId], userId, dbx);
  if (!visible.has(correction.foodId)) return null;
  const at = correction.at ?? new Date();
  const grams =
    typeof correction.grams === "number" &&
    Number.isFinite(correction.grams) &&
    correction.grams > 0
      ? correction.grams
      : null;
  const names = [correction.name, correction.localName ?? ""]
    .map((name) => ({
      name: (name ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
      key: memoryKey(name ?? ""),
    }))
    .filter((n, i, all) => n.key && all.findIndex((m) => m.key === n.key) === i);
  if (!names.length) return null;

  let first: MemoryRow | null = null;
  await dbx.transaction(async (tx) => {
    for (const { name, key } of names) {
      const current = (
        await tx
          .select()
          .from(foodMemory)
          .where(and(eq(foodMemory.userId, userId), eq(foodMemory.nameKey, key)))
          .for("update")
          .limit(1)
      )[0];
      let row: MemoryRow;
      if (!current) {
        [row] = (await tx
          .insert(foodMemory)
          .values({
            userId,
            nameKey: key,
            displayName: name,
            foodId: correction.foodId,
            typicalGrams: nextTypicalGrams(null, 0, grams),
            count: 1,
            snapshot: correction.snapshot ?? null,
            lastUsedAt: at,
          })
          .onConflictDoNothing()
          .returning()) as [MemoryRow];
        if (!row) continue;
      } else {
        const same = current.foodId === correction.foodId;
        [row] = (await tx
          .update(foodMemory)
          .set({
            displayName: name,
            foodId: correction.foodId,
            count: same ? current.count + 1 : 1,
            typicalGrams: same
              ? nextTypicalGrams(current.typicalGrams, current.count, grams)
              : nextTypicalGrams(null, 0, grams),
            snapshot: correction.snapshot === undefined ? current.snapshot : correction.snapshot,
            lastUsedAt: at,
          })
          .where(eq(foodMemory.id, current.id))
          .returning()) as [MemoryRow];
      }
      first ??= row;
    }
  });
  if (!first) return null;
  return (await withFoodNames(userId, [first], dbx))[0]!;
};

/**
 * The best remembered entry for each name: the same normalised name, else the most similar one
 * (trigram similarity 0.6 or more), more corrections first. Names with nothing are left out.
 */
export const recallFoods = async (
  userId: string,
  names: string[],
  dbx: DbOrTx = defaultDb,
): Promise<Map<string, FoodMemoryEntry>> => {
  const out = new Map<string, FoodMemoryEntry>();
  const wanted = [...new Set(names)].slice(0, 50).map((name) => ({ name, key: memoryKey(name) }));
  for (const { name, key } of wanted) {
    if (!key) continue;
    const rows = await dbx
      .select()
      .from(foodMemory)
      .where(
        and(
          eq(foodMemory.userId, userId),
          sql`(${foodMemory.nameKey} = ${key} or similarity(${foodMemory.nameKey}, ${key}) >= 0.6)`,
        ),
      )
      .orderBy(
        sql`(${foodMemory.nameKey} = ${key}) desc`,
        sql`similarity(${foodMemory.nameKey}, ${key}) desc`,
        desc(foodMemory.count),
        desc(foodMemory.lastUsedAt),
      )
      .limit(1);
    if (rows[0]) out.set(name, (await withFoodNames(userId, rows, dbx))[0]!);
  }
  return out;
};

/** The person's usual foods (most corrected, then most recent), for the analysis prompt. */
export const usualFoods = async (
  userId: string,
  options: { limit?: number } = {},
  dbx: DbOrTx = defaultDb,
): Promise<FoodMemoryEntry[]> => {
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 30)), 100);
  const rows = await dbx
    .select()
    .from(foodMemory)
    .where(and(eq(foodMemory.userId, userId), sql`${foodMemory.foodId} is not null`))
    .orderBy(desc(foodMemory.count), desc(foodMemory.lastUsedAt))
    .limit(limit);
  return withFoodNames(userId, rows, dbx);
};

/** Removes one entry. */
export const forgetFood = async (userId: string, memoryId: number, dbx: DbOrTx = defaultDb) => {
  if (!Number.isInteger(memoryId)) return false;
  const deleted = await dbx
    .delete(foodMemory)
    .where(and(eq(foodMemory.id, memoryId), eq(foodMemory.userId, userId)))
    .returning({ id: foodMemory.id });
  return deleted.length > 0;
};

type UsageRow = { food_id: string; n: number; last_at: Date | string; grams: number | null };

/** Foods the person logged (meal items) or corrected (memory) in the period, with counts. */
const usage = async (
  userId: string,
  order: "recent" | "frequent",
  limit: number,
  days: number,
  dbx: DbOrTx,
): Promise<RecentFood[]> => {
  const result = await dbx.execute(sql`
    select food_id, sum(n)::int as n, max(last_at) as last_at,
           (array_agg(grams order by last_at desc) filter (where grams is not null))[1] as grams
      from (
        select i.food_id, count(*) as n, max(i.created_at) as last_at,
               (array_agg(i.grams order by i.created_at desc))[1] as grams
          from meal_items i join meals m on m.id = i.meal_id
         where i.user_id = ${userId} and i.food_id is not null and m.deleted_at is null
           and i.created_at > now() - make_interval(days => ${days})
         group by i.food_id
        union all
        select food_id, count, last_used_at, typical_grams
          from food_memory
         where user_id = ${userId} and food_id is not null
           and last_used_at > now() - make_interval(days => ${days})
      ) s
     group by food_id
     order by ${order === "recent" ? sql`max(last_at) desc, sum(n) desc` : sql`sum(n) desc, max(last_at) desc`}
     limit ${limit * 2}`);
  const rows = result.rows as UsageRow[];
  const visible = await getFoodsByIds(
    rows.map((r) => r.food_id),
    userId,
    dbx,
  );
  return rows
    .filter((r) => visible.has(r.food_id))
    .slice(0, limit)
    .map((r) => ({
      food: visible.get(r.food_id)!,
      count: Number(r.n),
      lastUsedAt: new Date(r.last_at).toISOString(),
      typicalGrams: r.grams === null ? null : Number(r.grams),
    }));
};

/** Foods the person used most recently (last 90 days). */
export const recentFoods = (
  userId: string,
  options: { limit?: number } = {},
  dbx: DbOrTx = defaultDb,
) => usage(userId, "recent", Math.min(Math.max(1, options.limit ?? 20), 50), 90, dbx);

/** Foods the person used most often (default last 90 days). */
export const frequentFoods = (
  userId: string,
  options: { limit?: number; days?: number } = {},
  dbx: DbOrTx = defaultDb,
) =>
  usage(
    userId,
    "frequent",
    Math.min(Math.max(1, options.limit ?? 20), 50),
    Math.min(Math.max(1, Math.floor(options.days ?? 90)), 3650),
    dbx,
  );
