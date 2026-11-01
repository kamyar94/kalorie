// A person's own foods (CONTRACT: lib/contracts/foods.ts). Rows in foods with owner_id set and
// source "user": visible only to their owner, first in the owner's searches. Changing a food's
// values recomputes the person's dishes that use it.
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { dishComponents, foodPortions, foods } from "@/db/schema";
import type { FoodKind, FoodResult } from "@/lib/contracts/food-search";
import type { CustomFoodInput } from "@/lib/contracts/foods";
import { multiplyNutrients, type NutrientMap } from "@/lib/contracts/nutrients";

import { recomputeDishesUsing } from "./dishes";
import {
  cleanDensity,
  cleanGrams,
  cleanName,
  cleanNutrients,
  cleanPortions,
  cleanSynonyms,
  FoodInputError,
  type CleanPortion,
} from "./errors";
import { foodSearchText } from "./normalize";
import { normalizeBarcode } from "./barcode";
import { getFood, isFoodId, toFoodResults } from "./search";

type FoodRow = typeof foods.$inferSelect;

/** Values per 100 g from the input: per100g as given, or perServing scaled by servingGrams. */
const per100gFrom = (input: Partial<CustomFoodInput>, servingGrams: number | null): NutrientMap => {
  if (input.per100g !== undefined) return cleanNutrients(input.per100g, "per100g", true);
  if (input.perServing !== undefined) {
    if (!servingGrams)
      throw new FoodInputError("Give the serving weight with values per serving.", "servingGrams");
    const perServing = cleanNutrients(input.perServing, "perServing", false);
    return cleanNutrients(multiplyNutrients(perServing, 100 / servingGrams), "perServing", true);
  }
  return {};
};

const writePortions = async (dbx: DbOrTx, foodId: string, portions: CleanPortion[]) => {
  await dbx.delete(foodPortions).where(eq(foodPortions.foodId, foodId));
  if (portions.length)
    await dbx
      .insert(foodPortions)
      .values(portions.map((p, position) => ({ foodId, ...p, position })));
};

const defaultPortions = (servingGrams: number | null): CleanPortion[] =>
  servingGrams
    ? [{ label: "1 serving", labelFa: "۱ پرس", grams: servingGrams, amount: 1, unit: "portion" }]
    : [];

/** The person's own food or dish row, or null. */
export const ownFoodRow = async (userId: string, foodId: string, dbx: DbOrTx = defaultDb) => {
  if (!isFoodId(foodId)) return null;
  const rows = await dbx
    .select()
    .from(foods)
    .where(and(eq(foods.id, foodId), eq(foods.ownerId, userId)))
    .limit(1);
  return rows[0] ?? null;
};

export const createCustomFood = async (
  userId: string,
  input: CustomFoodInput,
  dbx: DbOrTx = defaultDb,
): Promise<FoodResult> => {
  const nameEn = cleanName(input.nameEn, "nameEn", true)!;
  const nameFa = cleanName(input.nameFa, "nameFa", false);
  const synonyms = cleanSynonyms(input.synonyms);
  const brand = cleanName(input.brand, "brand", false, 80);
  const servingGrams =
    input.servingGrams === undefined || input.servingGrams === null
      ? null
      : cleanGrams(input.servingGrams, "servingGrams");
  const barcode =
    input.barcode === undefined || input.barcode === null || input.barcode === ""
      ? null
      : normalizeBarcode(input.barcode);
  if (input.barcode && !barcode) throw new FoodInputError("That is not a barcode.", "barcode");
  const portions = input.portions ? cleanPortions(input.portions) : defaultPortions(servingGrams);
  const kind: FoodKind = input.kind === "packaged" ? "packaged" : "food";
  const values = {
    source: "user" as const,
    ownerId: userId,
    kind,
    nameEn,
    nameFa,
    synonyms,
    category: cleanName(input.category, "category", false, 80),
    brand,
    barcode,
    nutrients: per100gFrom(input, servingGrams),
    densityGPerMl: cleanDensity(input.densityGPerMl),
    servingGrams,
    sourceNote: cleanName(input.sourceNote, "sourceNote", false, 300) ?? "Your own food",
    searchText: foodSearchText({ nameEn, nameFa, synonyms, brand }),
  };
  const food = await dbx.transaction(async (tx) => {
    const [row] = await tx.insert(foods).values(values).returning();
    await writePortions(tx, row!.id, portions);
    return row!;
  });
  return (await toFoodResults([food], userId, dbx))[0]!;
};

/**
 * Changes the person's own food (not a dish's components: lib/food/dishes.ts). Fields left out
 * stay. New values recompute the person's dishes that use the food.
 */
export const updateCustomFood = async (
  userId: string,
  foodId: string,
  patch: Partial<CustomFoodInput>,
  dbx: DbOrTx = defaultDb,
): Promise<FoodResult | null> => {
  const updated = await dbx.transaction(async (tx) => {
    const row = await ownFoodRow(userId, foodId, tx);
    if (!row) return null;
    const set: Partial<typeof foods.$inferInsert> = {};
    const nameEn =
      patch.nameEn !== undefined ? cleanName(patch.nameEn, "nameEn", true)! : row.nameEn;
    const nameFa =
      patch.nameFa !== undefined ? cleanName(patch.nameFa, "nameFa", false) : row.nameFa;
    const synonyms = patch.synonyms !== undefined ? cleanSynonyms(patch.synonyms) : row.synonyms;
    const brand =
      patch.brand !== undefined ? cleanName(patch.brand, "brand", false, 80) : row.brand;
    const servingGrams =
      patch.servingGrams === undefined
        ? row.servingGrams
        : patch.servingGrams === null
          ? null
          : cleanGrams(patch.servingGrams, "servingGrams");
    Object.assign(set, {
      nameEn,
      nameFa,
      synonyms,
      brand,
      servingGrams,
      searchText: foodSearchText({ nameEn, nameFa, synonyms, brand }),
    });
    if (patch.category !== undefined)
      set.category = cleanName(patch.category, "category", false, 80);
    if (patch.barcode !== undefined) {
      const barcode = patch.barcode ? normalizeBarcode(patch.barcode) : null;
      if (patch.barcode && !barcode) throw new FoodInputError("That is not a barcode.", "barcode");
      set.barcode = barcode;
    }
    if (patch.kind !== undefined && row.kind !== "dish")
      set.kind = patch.kind === "packaged" ? "packaged" : "food";
    if (patch.densityGPerMl !== undefined) set.densityGPerMl = cleanDensity(patch.densityGPerMl);
    if (patch.sourceNote !== undefined)
      set.sourceNote = cleanName(patch.sourceNote, "sourceNote", false, 300) ?? "Your own food";
    const nutrientsChanged = patch.per100g !== undefined || patch.perServing !== undefined;
    if (nutrientsChanged) {
      if (row.kind === "dish")
        throw new FoodInputError("A dish's values come from its components.", "per100g");
      set.nutrients = per100gFrom(patch, servingGrams);
    }
    await tx.update(foods).set(set).where(eq(foods.id, row.id));
    if (patch.portions !== undefined)
      await writePortions(tx, row.id, cleanPortions(patch.portions));
    if (nutrientsChanged) await recomputeDishesUsing([row.id], tx);
    return row.id;
  });
  return updated ? getFood(updated, userId, dbx) : null;
};

/**
 * Deletes the person's own food or dish. Meal items keep their values (their link is cleared).
 * A food used in one of the person's dishes is refused with code "in_use".
 */
export const deleteCustomFood = async (
  userId: string,
  foodId: string,
  dbx: DbOrTx = defaultDb,
): Promise<boolean> =>
  dbx.transaction(async (tx) => {
    const row = await ownFoodRow(userId, foodId, tx);
    if (!row) return false;
    const used = await tx
      .select({ dishId: dishComponents.dishId, name: foods.nameEn })
      .from(dishComponents)
      .innerJoin(foods, eq(foods.id, dishComponents.dishId))
      .where(eq(dishComponents.componentId, row.id))
      .limit(1);
    if (used[0])
      throw new FoodInputError(
        `"${row.nameEn}" is part of the dish "${used[0].name}". Remove it there first.`,
        null,
        "in_use",
      );
    await tx.delete(foods).where(eq(foods.id, row.id));
    return true;
  });

/**
 * A personal copy of any food the person can see (a shared dish to adjust, for example), with
 * its portions and, for dishes, its components. overrides change the copy's names.
 */
export const copyFood = async (
  userId: string,
  foodId: string,
  overrides: { nameEn?: string; nameFa?: string | null } = {},
  dbx: DbOrTx = defaultDb,
): Promise<FoodResult | null> => {
  const source = await getFood(foodId, userId, dbx);
  if (!source) return null;
  const nameEn =
    overrides.nameEn !== undefined ? cleanName(overrides.nameEn, "nameEn", true)! : source.nameEn;
  const nameFa =
    overrides.nameFa !== undefined ? cleanName(overrides.nameFa, "nameFa", false) : source.nameFa;
  const copied = await dbx.transaction(async (tx) => {
    const original = (await tx.select().from(foods).where(eq(foods.id, source.id)).limit(1))[0]!;
    const [row] = await tx
      .insert(foods)
      .values({
        source: "user",
        ownerId: userId,
        kind:
          original.kind === "dish" ? "dish" : original.kind === "packaged" ? "packaged" : "food",
        nameEn,
        nameFa,
        synonyms: original.synonyms,
        category: original.category,
        brand: original.brand,
        barcode: original.barcode,
        nutrients: original.nutrients,
        densityGPerMl: original.densityGPerMl,
        servingGrams: original.servingGrams,
        sourceNote: `Your copy of "${original.nameEn}". ${original.sourceNote ?? ""}`
          .trim()
          .slice(0, 500),
        searchText: foodSearchText({
          nameEn,
          nameFa,
          synonyms: original.synonyms,
          brand: original.brand,
        }),
      })
      .returning();
    const portions = await tx
      .select()
      .from(foodPortions)
      .where(eq(foodPortions.foodId, original.id));
    if (portions.length)
      await tx
        .insert(foodPortions)
        .values(portions.map(({ id: _id, foodId: _f, ...p }) => ({ ...p, foodId: row!.id })));
    const parts = await tx
      .select()
      .from(dishComponents)
      .where(eq(dishComponents.dishId, original.id));
    if (parts.length)
      await tx
        .insert(dishComponents)
        .values(parts.map(({ id: _id, dishId: _d, ...p }) => ({ ...p, dishId: row!.id })));
    return row!;
  });
  return (await toFoodResults([copied], userId, dbx))[0]!;
};

/** The person's own foods and dishes, newest first. */
export const listCustomFoods = async (
  userId: string,
  options: { kinds?: FoodKind[]; limit?: number } = {},
  dbx: DbOrTx = defaultDb,
): Promise<FoodResult[]> => {
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 50)), 200);
  const rows: FoodRow[] = await dbx
    .select()
    .from(foods)
    .where(
      and(
        eq(foods.ownerId, userId),
        options.kinds?.length ? inArray(foods.kind, options.kinds) : sql`true`,
      ),
    )
    .orderBy(desc(foods.updatedAt))
    .limit(limit);
  return toFoodResults(rows, userId, dbx);
};
