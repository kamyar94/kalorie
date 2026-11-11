// A Mealie recipe as a food in Kal (docs/DESIGN.md section 8). Each recipe the person uses becomes
// their own food row (owner_id, source "mealie", source_id = Mealie's recipe id) so it can be
// logged, searched and linked by the analysis:
//   - Mealie has nutrition: kind "recipe", values per serving from Mealie's fields.
//   - Mealie's nutrition is empty: Kal matches the ingredients to its foods and keeps the result
//     as a dish (kind "dish", dish_components per serving, source note "Computed by Kal ..."),
//     shown as "computed". Such dishes are recomputed when their foods change (lib/food).
//   - Neither: no food row; the recipe cannot be logged with numbers.
// The serving weight comes from the ingredients when they resolve; otherwise a nominal 300 g is
// used and said in the source note (values per serving stay exact, grams are nominal).
import { and, eq } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { dishComponents, foodPortions, foods } from "@/db/schema";
import type { RecipeInfoDto, RecipeNutritionSource } from "@/lib/contracts/integrations";
import { multiplyNutrients, type NutrientMap } from "@/lib/contracts/nutrients";
import { computeDish } from "@/lib/food/dish-core";
import { foodSearchText } from "@/lib/food/normalize";
import { getFoodsByIds, toFoodResults } from "@/lib/food/search";

import type { MealieRecipe } from "./client";
import { matchIngredients } from "./ingredients";
import { isNutritionEmpty, mealieToNutrients } from "./nutrition";

export const NOMINAL_SERVING_GRAMS = 300;
/** A stored recipe is reused without asking Mealie again for this long. */
export const RECIPE_FRESH_MS = 6 * 3600_000;

const tidy = (value: number) => Math.round(value * 1000) / 1000;

/** Servings the recipe makes: recipeServings, else the yield quantity, else 1. */
export const recipeServings = (
  recipe: Pick<MealieRecipe, "recipeServings" | "recipeYieldQuantity">,
) => {
  for (const value of [recipe.recipeServings, recipe.recipeYieldQuantity])
    if (typeof value === "number" && Number.isFinite(value) && value > 0)
      return Math.min(value, 100);
  return 1;
};

/** Mealie's own version stamp of a recipe, kept in foods.data_release. */
const versionOf = (recipe: MealieRecipe) => recipe.updatedAt ?? recipe.dateUpdated ?? null;

export const recipeFoodRow = async (userId: string, recipeId: string, dbx: DbOrTx = defaultDb) =>
  (
    await dbx
      .select()
      .from(foods)
      .where(
        and(eq(foods.ownerId, userId), eq(foods.source, "mealie"), eq(foods.sourceId, recipeId)),
      )
      .limit(1)
  )[0] ?? null;

type FoodRow = typeof foods.$inferSelect;

const infoFromRow = async (
  userId: string,
  recipe: MealieRecipe,
  row: FoodRow | null,
  dbx: DbOrTx,
  counts?: { total: number; matched: number },
  mealieEmpty = isNutritionEmpty(recipe.nutrition),
): Promise<RecipeInfoDto> => {
  const source: RecipeNutritionSource = !row ? "none" : row.kind === "dish" ? "computed" : "mealie";
  const servingGrams = row?.servingGrams ?? NOMINAL_SERVING_GRAMS;
  const perServing = row ? multiplyNutrients(row.nutrients, servingGrams / 100) : {};
  const fromNote = /from (\d+) of (\d+) ingredients/.exec(row?.sourceNote ?? "");
  const stored = fromNote ? { matched: Number(fromNote[1]), total: Number(fromNote[2]) } : null;
  return {
    id: recipe.id,
    slug: recipe.slug,
    name: recipe.name?.trim() || "Recipe",
    servings: recipeServings(recipe),
    nutritionSource: source,
    perServing,
    servingGrams,
    ingredients: counts ?? stored ?? { total: 0, matched: 0 },
    canSaveToMealie: source === "computed" && mealieEmpty,
    food: row ? ((await toFoodResults([row], userId, dbx))[0] ?? null) : null,
  };
};

/**
 * What Kal stored for a recipe, without asking Mealie (the Today screen). A stored dish was
 * computed because Mealie's nutrition was empty when it was imported.
 */
export const storedRecipeInfo = (
  userId: string,
  summary: MealieRecipe,
  row: FoodRow,
  dbx: DbOrTx = defaultDb,
) => infoFromRow(userId, summary, row, dbx, undefined, row.kind === "dish");

/**
 * Stores (or refreshes) the recipe as the person's food and returns what Kal knows about it.
 * Reuses the stored row while it is fresh and Mealie's version stamp has not changed.
 */
export const importRecipe = async (
  userId: string,
  recipe: MealieRecipe,
  options: { force?: boolean } = {},
  dbx: DbOrTx = defaultDb,
): Promise<RecipeInfoDto> => {
  const existing = await recipeFoodRow(userId, recipe.id, dbx);
  const version = versionOf(recipe);
  if (
    existing &&
    !options.force &&
    existing.dataRelease === version &&
    Date.now() - existing.updatedAt.getTime() < RECIPE_FRESH_MS &&
    (existing.kind === "dish") === isNutritionEmpty(recipe.nutrition)
  )
    return infoFromRow(userId, recipe, existing, dbx);

  const servings = recipeServings(recipe);
  const ingredients = await matchIngredients(userId, recipe.recipeIngredient ?? [], dbx);
  const perServingParts = ingredients.parts.map((p) => ({ ...p, grams: p.grams / servings }));
  const componentFoods = await getFoodsByIds(
    perServingParts.map((p) => p.foodId),
    userId,
    dbx,
  );
  const computed = computeDish(
    perServingParts.map((p) => ({
      grams: p.grams,
      per100g: componentFoods.get(p.foodId)?.per100g ?? {},
    })),
  );
  // Ingredient weight counts as the serving weight only when most ingredients resolved.
  const weightKnown =
    ingredients.total > 0 &&
    ingredients.matched / ingredients.total >= 0.5 &&
    computed.servingGrams > 0;

  let kind: "recipe" | "dish";
  let perServing: NutrientMap;
  let servingGrams: number;
  let note: string;
  const counts = { total: ingredients.total, matched: ingredients.matched };
  if (!isNutritionEmpty(recipe.nutrition)) {
    kind = "recipe";
    perServing = mealieToNutrients(recipe.nutrition);
    servingGrams = weightKnown ? computed.servingGrams : NOMINAL_SERVING_GRAMS;
    note = `Mealie recipe, nutrition per serving from Mealie.${weightKnown ? "" : " Serving weight not known; 300 g is used."}`;
  } else if (ingredients.matched > 0 && typeof computed.perServing.energy === "number") {
    kind = "dish";
    perServing = computed.perServing;
    servingGrams = computed.servingGrams;
    note = `Computed by Kal from ${ingredients.matched} of ${ingredients.total} ingredients of the Mealie recipe (${servings} ${servings === 1 ? "serving" : "servings"}).`;
  } else {
    if (existing)
      await dbx
        .delete(foods)
        .where(eq(foods.id, existing.id))
        .catch(() => undefined);
    return infoFromRow(userId, recipe, null, dbx, counts);
  }

  const name = recipe.name?.trim().slice(0, 120) || "Recipe";
  const values = {
    kind,
    nameEn: name,
    category: "Mealie recipe",
    nutrients: multiplyNutrients(perServing, 100 / servingGrams),
    servingGrams: tidy(servingGrams),
    sourceNote: note,
    dataRelease: version,
    searchText: foodSearchText({ nameEn: name, synonyms: [recipe.slug.replace(/-/g, " ")] }),
    updatedAt: new Date(),
  };
  const row = await dbx.transaction(async (tx) => {
    const [saved] = existing
      ? await tx.update(foods).set(values).where(eq(foods.id, existing.id)).returning()
      : await tx
          .insert(foods)
          .values({ source: "mealie", sourceId: recipe.id, ownerId: userId, ...values })
          .returning();
    await tx.delete(dishComponents).where(eq(dishComponents.dishId, saved!.id));
    if (kind === "dish")
      await tx.insert(dishComponents).values(
        perServingParts.map((p, position) => ({
          dishId: saved!.id,
          componentId: p.foodId,
          grams: tidy(p.grams),
          position,
          note: p.name.slice(0, 120),
        })),
      );
    await tx.delete(foodPortions).where(eq(foodPortions.foodId, saved!.id));
    await tx.insert(foodPortions).values({
      foodId: saved!.id,
      label: "1 serving",
      labelFa: "۱ پرس",
      amount: 1,
      unit: "portion",
      grams: tidy(servingGrams),
      position: 0,
    });
    return saved!;
  });
  return infoFromRow(userId, recipe, row, dbx, counts);
};
