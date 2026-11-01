// Dishes (CONTRACT: lib/contracts/foods.ts): foods of kind "dish" made of components (a food and
// its grams in one serving), with values computed from the components (lib/food/dish-core.ts)
// and recomputed whenever a component's values or the components change.
import { and, asc, eq, sql, type SQL } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { dishComponents, foodPortions, foods } from "@/db/schema";
import type { FoodResult } from "@/lib/contracts/food-search";
import type { DishComponentDto, DishInput } from "@/lib/contracts/foods";
import { scaleNutrients } from "@/lib/contracts/nutrients";

import { computeDish, recomputeDishes, type QueryRows } from "./dish-core";
import {
  cleanGrams,
  cleanName,
  cleanPortions,
  cleanSynonyms,
  FoodInputError,
  type CleanPortion,
} from "./errors";
import { foodSearchText } from "./normalize";
import { getFood, getFoodsByIds, isFoodId } from "./search";

const MAX_COMPONENTS = 60;

/** Runs dish-core's SQL ($1, $2 placeholders) through Drizzle, inside a transaction too. */
export const drizzleQuery =
  (dbx: DbOrTx): QueryRows =>
  async (text, params) => {
    const parts = text.split(/\$(\d+)/);
    const chunks: SQL[] = parts.map((part, i) =>
      i % 2 === 0 ? sql.raw(part) : sql`${sql.param(params[Number(part) - 1])}`,
    );
    const result = await dbx.execute(sql.join(chunks));
    return result.rows as Record<string, unknown>[];
  };

/** Recomputes the dishes that use these foods, directly or through other dishes. */
export const recomputeDishesUsing = (foodIds: string[], dbx: DbOrTx = defaultDb) =>
  recomputeDishes(drizzleQuery(dbx), foodIds);

/** Recomputes one dish from its components, and the dishes made with it. */
export const recomputeDish = (dishId: string, dbx: DbOrTx = defaultDb) =>
  recomputeDishes(drizzleQuery(dbx), [], [dishId]);

type CleanComponent = { foodId: string; grams: number; note: string | null };

const cleanComponents = async (
  userId: string,
  values: unknown,
  dishId: string | null,
  dbx: DbOrTx,
): Promise<CleanComponent[]> => {
  if (!Array.isArray(values) || !values.length)
    throw new FoodInputError("Add at least one component.", "components");
  if (values.length > MAX_COMPONENTS)
    throw new FoodInputError(`Use at most ${MAX_COMPONENTS} components.`, "components");
  const parts = values.map((value: { foodId?: unknown; grams?: unknown; note?: unknown }) => {
    if (!isFoodId(value?.foodId)) throw new FoodInputError("Choose a food.", "components");
    return {
      foodId: value.foodId,
      grams: cleanGrams(value.grams, "components"),
      note: cleanName(value.note, "components", false, 120),
    };
  });
  const visible = await getFoodsByIds(
    parts.map((p) => p.foodId),
    userId,
    dbx,
  );
  for (const part of parts)
    if (!visible.has(part.foodId))
      throw new FoodInputError(
        "One of the components is not available.",
        "components",
        "not_found",
      );
  if (dishId) {
    // No dish may contain itself, directly or through other dishes.
    const ids = [...new Set(parts.map((p) => p.foodId))];
    if (ids.includes(dishId))
      throw new FoodInputError("A dish cannot contain itself.", "components", "cycle");
    const loop = await dbx.execute(sql`
      with recursive inside(id) as (
        select component_id from dish_components
         where dish_id in (${sql.join(
           ids.map((id) => sql`${id}::uuid`),
           sql`, `,
         )})
        union
        select dc.component_id from dish_components dc join inside on dc.dish_id = inside.id
      )
      select 1 from inside where id = ${dishId}::uuid limit 1`);
    if (loop.rows.length)
      throw new FoodInputError("A dish cannot contain itself.", "components", "cycle");
  }
  return parts;
};

const writeComponents = async (dbx: DbOrTx, dishId: string, parts: CleanComponent[]) => {
  await dbx.delete(dishComponents).where(eq(dishComponents.dishId, dishId));
  await dbx.insert(dishComponents).values(
    parts.map((p, position) => ({
      dishId,
      componentId: p.foodId,
      grams: p.grams,
      note: p.note,
      position,
    })),
  );
};

const writePortions = async (dbx: DbOrTx, foodId: string, portions: CleanPortion[]) => {
  await dbx.delete(foodPortions).where(eq(foodPortions.foodId, foodId));
  if (portions.length)
    await dbx
      .insert(foodPortions)
      .values(portions.map((p, position) => ({ foodId, ...p, position })));
};

const servingPortion = (grams: number): CleanPortion => ({
  label: "1 serving",
  labelFa: "۱ پرس",
  grams,
  amount: 1,
  unit: "portion",
});

/** A personal dish from components. */
export const createDish = async (
  userId: string,
  input: DishInput,
  dbx: DbOrTx = defaultDb,
): Promise<FoodResult> => {
  const nameEn = cleanName(input.nameEn, "nameEn", true)!;
  const nameFa = cleanName(input.nameFa, "nameFa", false);
  const synonyms = cleanSynonyms(input.synonyms);
  const explicit =
    input.servingGrams === undefined || input.servingGrams === null
      ? null
      : cleanGrams(input.servingGrams, "servingGrams");
  const id = await dbx.transaction(async (tx) => {
    const parts = await cleanComponents(userId, input.components, null, tx);
    const componentFoods = await getFoodsByIds(
      parts.map((p) => p.foodId),
      userId,
      tx,
    );
    const computed = computeDish(
      parts.map((p) => ({ grams: p.grams, per100g: componentFoods.get(p.foodId)!.per100g })),
      explicit,
    );
    const [row] = await tx
      .insert(foods)
      .values({
        source: "user",
        ownerId: userId,
        kind: "dish",
        nameEn,
        nameFa,
        synonyms,
        category: cleanName(input.category, "category", false, 80),
        nutrients: computed.per100g,
        servingGrams: computed.servingGrams,
        sourceNote:
          cleanName(input.sourceNote, "sourceNote", false, 300) ??
          "Your dish, computed from its components",
        searchText: foodSearchText({ nameEn, nameFa, synonyms }),
      })
      .returning({ id: foods.id });
    await writeComponents(tx, row!.id, parts);
    await writePortions(
      tx,
      row!.id,
      input.portions ? cleanPortions(input.portions) : [servingPortion(computed.servingGrams)],
    );
    return row!.id;
  });
  return (await getFood(id, userId, dbx))!;
};

/**
 * Changes the person's own dish. New components recompute it; the serving weight follows the
 * components' sum unless it was set apart from it (a cooked weight), or a new one is given
 * (null: back to the sum). Dishes made with this dish are recomputed too.
 */
export const updateDish = async (
  userId: string,
  dishId: string,
  patch: Partial<DishInput>,
  dbx: DbOrTx = defaultDb,
): Promise<FoodResult | null> => {
  if (!isFoodId(dishId)) return null;
  const done = await dbx.transaction(async (tx) => {
    const row = (
      await tx
        .select()
        .from(foods)
        .where(and(eq(foods.id, dishId), eq(foods.ownerId, userId), eq(foods.kind, "dish")))
        .limit(1)
    )[0];
    if (!row) return false;
    const oldParts = await tx
      .select({ grams: dishComponents.grams })
      .from(dishComponents)
      .where(eq(dishComponents.dishId, dishId));
    const oldSum = oldParts.reduce((sum, p) => sum + p.grams, 0);
    const followedSum = row.servingGrams === null || Math.abs(row.servingGrams - oldSum) < 0.5;

    const nameEn =
      patch.nameEn !== undefined ? cleanName(patch.nameEn, "nameEn", true)! : row.nameEn;
    const nameFa =
      patch.nameFa !== undefined ? cleanName(patch.nameFa, "nameFa", false) : row.nameFa;
    const synonyms = patch.synonyms !== undefined ? cleanSynonyms(patch.synonyms) : row.synonyms;
    const set: Partial<typeof foods.$inferInsert> = {
      nameEn,
      nameFa,
      synonyms,
      searchText: foodSearchText({ nameEn, nameFa, synonyms }),
    };
    if (patch.category !== undefined)
      set.category = cleanName(patch.category, "category", false, 80);
    if (patch.sourceNote !== undefined)
      set.sourceNote =
        cleanName(patch.sourceNote, "sourceNote", false, 300) ??
        "Your dish, computed from its components";

    let parts: CleanComponent[] | null = null;
    if (patch.components !== undefined) {
      parts = await cleanComponents(userId, patch.components, dishId, tx);
      await writeComponents(tx, dishId, parts);
    }
    const newSum = parts ? parts.reduce((sum, p) => sum + p.grams, 0) : oldSum;
    const servingGrams =
      patch.servingGrams === null
        ? newSum
        : patch.servingGrams !== undefined
          ? cleanGrams(patch.servingGrams, "servingGrams")
          : followedSum
            ? newSum
            : (row.servingGrams ?? newSum);
    set.servingGrams = servingGrams;
    await tx.update(foods).set(set).where(eq(foods.id, dishId));

    if (patch.portions !== undefined)
      await writePortions(tx, dishId, cleanPortions(patch.portions));
    else if (servingGrams !== row.servingGrams && row.servingGrams !== null)
      await tx
        .update(foodPortions)
        .set({ grams: servingGrams })
        .where(
          and(
            eq(foodPortions.foodId, dishId),
            eq(foodPortions.label, "1 serving"),
            eq(foodPortions.grams, row.servingGrams),
          ),
        );
    await recomputeDish(dishId, tx);
    return true;
  });
  return done ? getFood(dishId, userId, dbx) : null;
};

/** The components of a dish the person can see, in order. */
export const getDishComponents = async (
  userId: string,
  dishId: string,
  dbx: DbOrTx = defaultDb,
): Promise<DishComponentDto[] | null> => {
  const dish = await getFood(dishId, userId, dbx);
  if (!dish || dish.kind !== "dish") return null;
  const rows = await dbx
    .select({
      id: dishComponents.id,
      foodId: dishComponents.componentId,
      grams: dishComponents.grams,
      note: dishComponents.note,
      nameEn: foods.nameEn,
      nameFa: foods.nameFa,
      source: foods.source,
      per100g: foods.nutrients,
    })
    .from(dishComponents)
    .innerJoin(foods, eq(foods.id, dishComponents.componentId))
    .where(eq(dishComponents.dishId, dish.id))
    .orderBy(asc(dishComponents.position), asc(dishComponents.id));
  return rows.map((row) => ({ ...row, nutrients: scaleNutrients(row.per100g, row.grams) }));
};
