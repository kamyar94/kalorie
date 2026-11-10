// Mealie for one person (docs/DESIGN.md section 8). The base URL is the server's
// (MEALIE_BASE_URL); the person's API token is stored encrypted (lib/integrations/store.ts).
// Nothing is written to Mealie except a confirmed meal plan and "Save nutrition to Mealie".
import { and, eq, inArray, isNull, isNotNull } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { mealItems, meals } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { PlannedRecipe } from "@/lib/contracts/analysis";
import type {
  LogPlannedResult,
  MealieRecipeHit,
  PlannedMealDto,
  PlanEntryDto,
  PlanRequestDto,
  PlanSuggestionDto,
  RecipeInfoDto,
} from "@/lib/contracts/integrations";
import { PLAN_SLOTS } from "@/lib/contracts/integrations";
import { MEAL_SLOTS, type MealSlot } from "@/lib/contracts/meals";
import { createManualMeal, ManualMealError } from "@/lib/meals/manual";
import { isValidTimeZone, localParts } from "@/lib/meals/time";
import { getTargets } from "@/lib/targets/service";

import { integrationConfig } from "../config";
import { IntegrationError, isIntegrationError } from "../http";
import {
  getIntegrationRow,
  credentialOf,
  removeIntegration,
  saveCredential,
  updateIntegration,
} from "../store";
import { mealieClient, type MealieClient, type MealiePlanEntry, type MealieRecipe } from "./client";
import { isNutritionEmpty, mealieToNutrients, nutrientsToMealie } from "./nutrition";
import { suggestPlan, type PlanRecipe } from "./planner";
import { importRecipe, RECIPE_FRESH_MS, recipeFoodRow, storedRecipeInfo } from "./recipes";

const NOT_CONNECTED = "Connect Mealie in Settings first.";
const TOKEN_REFUSED = "Mealie no longer accepts the saved token. Paste a new one in Settings.";

/** The person's Mealie client. Throws IntegrationError (not_configured, auth). */
export const mealieFor = async (userId: string, dbx: DbOrTx = defaultDb): Promise<MealieClient> => {
  const config = integrationConfig();
  if (!config.mealieBaseUrl)
    throw new IntegrationError("not_configured", "Mealie is not set up on this server.");
  const token = credentialOf(await getIntegrationRow(userId, "mealie", dbx));
  if (!token) throw new IntegrationError("auth", NOT_CONNECTED);
  return mealieClient(config.mealieBaseUrl, token, config.timeoutMs);
};

/** Runs a Mealie call and keeps the stored status in step (refused token -> error). */
const withMealie = async <T>(
  userId: string,
  run: (client: MealieClient) => Promise<T>,
  dbx: DbOrTx = defaultDb,
): Promise<T> => {
  const client = await mealieFor(userId, dbx);
  try {
    const result = await run(client);
    const row = await getIntegrationRow(userId, "mealie", dbx);
    if (
      row &&
      (row.status !== "ok" || !row.lastSyncAt || Date.now() - row.lastSyncAt.getTime() > 60_000)
    )
      await updateIntegration(
        userId,
        "mealie",
        { status: "ok", statusMessage: null, lastSyncAt: new Date() },
        dbx,
      );
    return result;
  } catch (error) {
    if (isIntegrationError(error) && error.kind === "auth")
      await updateIntegration(
        userId,
        "mealie",
        { status: "error", statusMessage: TOKEN_REFUSED },
        dbx,
      );
    throw error;
  }
};

const cleanToken = (value: unknown) =>
  typeof value === "string" && /^[\x21-\x7e]{10,4096}$/.test(value.trim()) ? value.trim() : null;

export type ConnectResult =
  { ok: true } | { ok: false; status: 400 | 422 | 502 | 503; error: string };

const failure = (error: unknown): { ok: false; status: 422 | 502 | 503; error: string } => {
  if (!isIntegrationError(error)) throw error;
  if (error.kind === "auth") return { ok: false, status: 422, error: error.message };
  if (error.kind === "not_configured") return { ok: false, status: 503, error: error.message };
  return { ok: false, status: 502, error: error.message };
};

/** Tests the token against Mealie and stores it (encrypted) when Mealie accepts it. */
export const connectMealie = async (
  userId: string,
  token: unknown,
  dbx: DbOrTx = defaultDb,
): Promise<ConnectResult> => {
  const config = integrationConfig();
  if (!config.mealieBaseUrl)
    return { ok: false, status: 503, error: "Mealie is not set up on this server." };
  const clean = cleanToken(token);
  if (!clean)
    return { ok: false, status: 400, error: "Paste the API token from your Mealie profile." };
  try {
    await mealieClient(config.mealieBaseUrl, clean, config.timeoutMs).self();
  } catch (error) {
    if (isIntegrationError(error) && error.kind === "auth")
      return {
        ok: false,
        status: 422,
        error: "Mealie did not accept this token. Check it and try again.",
      };
    return failure(error);
  }
  await saveCredential(userId, "mealie", clean, {}, dbx);
  await updateIntegration(userId, "mealie", { lastSyncAt: new Date() }, dbx);
  await audit(
    { userId, action: "integration.connect", targetType: "integration", targetId: "mealie" },
    dbx,
  );
  plannedCache.clear();
  return { ok: true };
};

/** Asks Mealie whether the stored token still works. */
export const testMealie = async (
  userId: string,
  dbx: DbOrTx = defaultDb,
): Promise<ConnectResult> => {
  try {
    await withMealie(userId, (client) => client.self(), dbx);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
};

export const disconnectMealie = async (userId: string, dbx: DbOrTx = defaultDb) => {
  const removed = await removeIntegration(userId, "mealie", dbx);
  if (removed)
    await audit(
      { userId, action: "integration.disconnect", targetType: "integration", targetId: "mealie" },
      dbx,
    );
  plannedCache.clear();
  return removed;
};

// ---- Planned meals ----

/** Mealie's entry types that are Cal's meal slots (all but side); null for side. */
export const slotOfEntry = (entryType: string): MealSlot | null =>
  (MEAL_SLOTS as readonly string[]).includes(entryType) ? (entryType as MealSlot) : null;

/** Cal's slot as a Mealie entry type: Mealie has no supper, so it is dinner there. */
export const mealieEntryType = (slot: MealSlot) => (slot === "supper" ? "dinner" : slot);

export const PLAN_CLIENT_PREFIX = "mealie-plan:";

/** Plan entries of one day, cached a minute per person (the Today screen asks often). */
const plannedCache = new Map<string, { at: number; entries: MealiePlanEntry[] }>();
const PLANNED_TTL_MS = 60_000;

/**
 * The household's plan entries of a local day. The day the viewer calls today comes from
 * GET /api/households/mealplans/today; when Mealie's "today" is another day (its server's time
 * zone) or for other days, from the date range query.
 */
export const planEntriesFor = async (
  userId: string,
  localDate: string,
  today: string,
  dbx: DbOrTx = defaultDb,
): Promise<MealiePlanEntry[]> => {
  const key = `${userId}:${localDate}`;
  const cached = plannedCache.get(key);
  if (cached && Date.now() - cached.at < PLANNED_TTL_MS) return cached.entries;
  const entries = await withMealie(
    userId,
    async (client) => {
      if (localDate === today) {
        const todays = await client.todayPlan();
        // Mealie's "today" may be another day than the person's; an empty answer proves nothing.
        if (todays.length && todays.every((e) => e.date === localDate)) return todays;
      }
      return (await client.plans(localDate, localDate)).filter((e) => e.date === localDate);
    },
    dbx,
  );
  plannedCache.set(key, { at: Date.now(), entries });
  if (plannedCache.size > 500) plannedCache.delete(plannedCache.keys().next().value!);
  return entries;
};

export const clearPlannedCache = () => plannedCache.clear();

/** Recipe of a plan entry, imported into Cal (null for entries without a recipe). */
const recipeOfEntry = async (
  userId: string,
  client: MealieClient,
  entry: MealiePlanEntry,
  dbx: DbOrTx,
): Promise<RecipeInfoDto | null> => {
  const id = entry.recipeId ?? entry.recipe?.id;
  if (!id) return null;
  const stored = await recipeFoodRow(userId, id, dbx);
  // Fresh enough: no detail call for the Today screen.
  if (stored && entry.recipe && Date.now() - stored.updatedAt.getTime() < RECIPE_FRESH_MS)
    return storedRecipeInfo(userId, entry.recipe, stored, dbx);
  return importRecipe(userId, await client.recipe(id), {}, dbx);
};

/** Planned recipes of the day for the Today screen, with energy per serving and logged state. */
export const getPlannedMeals = async (
  userId: string,
  localDate: string,
  today: string,
  dbx: DbOrTx = defaultDb,
): Promise<PlannedMealDto[]> => {
  const entries = await planEntriesFor(userId, localDate, today, dbx);
  if (!entries.length) return [];
  const client = await mealieFor(userId, dbx);
  const loggedRows = await dbx
    .select({ clientId: meals.clientId })
    .from(meals)
    .where(
      and(
        eq(meals.userId, userId),
        isNull(meals.deletedAt),
        inArray(
          meals.clientId,
          entries.map((e) => `${PLAN_CLIENT_PREFIX}${e.id}`),
        ),
      ),
    );
  const logged = new Set(loggedRows.map((r) => r.clientId));
  const out: PlannedMealDto[] = [];
  for (const entry of entries.slice(0, 20)) {
    const info = await recipeOfEntry(userId, client, entry, dbx).catch(() => null);
    const name = entry.recipe?.name?.trim() || entry.title?.trim() || info?.name || "Planned meal";
    out.push({
      id: String(entry.id),
      recipeId: entry.recipeId ?? entry.recipe?.id ?? null,
      recipeSlug: entry.recipe?.slug ?? info?.slug ?? null,
      name,
      slot: slotOfEntry(entry.entryType),
      kcalPerServing:
        info && typeof info.perServing.energy === "number"
          ? Math.round(info.perServing.energy)
          : null,
      servings: 1,
      logged: logged.has(`${PLAN_CLIENT_PREFIX}${entry.id}`),
    });
  }
  return out;
};

/** The day's planned recipes for the photo analysis (lib/analysis/planned.ts). */
export const plannedRecipesForAnalysis = async (
  userId: string,
  localDate: string,
  dbx: DbOrTx = defaultDb,
): Promise<PlannedRecipe[]> => {
  const config = integrationConfig();
  if (!config.mealieBaseUrl) return [];
  const row = await getIntegrationRow(userId, "mealie", dbx);
  if (!credentialOf(row)) return [];
  const entries = await planEntriesFor(userId, localDate, localDate, dbx);
  const client = await mealieFor(userId, dbx);
  const out: PlannedRecipe[] = [];
  for (const entry of entries.slice(0, 20)) {
    const id = entry.recipeId ?? entry.recipe?.id;
    if (!id) continue;
    const info = await recipeOfEntry(userId, client, entry, dbx).catch(() => null);
    out.push({
      id,
      name: entry.recipe?.name?.trim() || info?.name || entry.title?.trim() || "Recipe",
      slot: slotOfEntry(entry.entryType),
      foodId: info?.food?.id ?? null,
      servingGrams: info?.food ? info.servingGrams : null,
      nutritionPerServing: info && info.nutritionSource !== "none" ? info.perServing : null,
    });
  }
  return out;
};

/** Logs a planned recipe as a meal: servings of the recipe's food, nutrients from the recipe. */
export const logPlannedMeal = async (
  userId: string,
  planId: string,
  input: { servings: number; eatenAt: string; tz: string },
  dbx: DbOrTx = defaultDb,
): Promise<LogPlannedResult> => {
  if (!/^\d{1,12}$/.test(planId))
    return { ok: false, status: 404, error: "This planned meal is not available." };
  const clientId = `${PLAN_CLIENT_PREFIX}${planId}`;
  const existing = (
    await dbx
      .select({ id: meals.id, deletedAt: meals.deletedAt })
      .from(meals)
      .where(and(eq(meals.userId, userId), eq(meals.clientId, clientId)))
      .limit(1)
  )[0];
  if (existing && !existing.deletedAt) return { ok: true, mealId: existing.id };

  let info: RecipeInfoDto;
  let entry: MealiePlanEntry;
  try {
    const client = await mealieFor(userId, dbx);
    entry = await withMealie(userId, (c) => c.planEntry(planId), dbx);
    const recipeId = entry.recipeId ?? entry.recipe?.id;
    if (!recipeId)
      return { ok: false, status: 422, error: "This plan entry has no recipe to log." };
    info = await importRecipe(userId, await client.recipe(recipeId), {}, dbx);
  } catch (error) {
    if (isIntegrationError(error) && error.kind === "not_found")
      return { ok: false, status: 404, error: "This planned meal is not in Mealie any more." };
    const result = failure(error);
    return {
      ok: false,
      status: result.status === 422 ? 409 : result.status === 503 ? 503 : 502,
      error: result.error,
    };
  }
  if (!info.food)
    return {
      ok: false,
      status: 422,
      error: "Cal could not work out this recipe's nutrition. Add its foods by hand.",
    };

  const servings = Math.min(Math.max(input.servings, 0.25), 20);
  const tz = isValidTimeZone(input.tz) ? input.tz : "UTC";
  try {
    const meal = await dbx.transaction(async (tx) => {
      // A deleted earlier log of this entry gives its client id back.
      if (existing) await tx.update(meals).set({ clientId: null }).where(eq(meals.id, existing.id));
      const slot = slotOfEntry(entry.entryType);
      const created = await createManualMeal(
        userId,
        {
          eatenAt: input.eatenAt,
          tz,
          ...(slot ? { slot } : {}),
          title: info.name,
          source: "mealie",
          clientId,
          items: [
            {
              name: info.name,
              kind: "dish",
              foodId: info.food!.id,
              grams: info.servingGrams,
              count: servings,
              portionText: servings === 1 ? "1 serving" : `${servings} servings`,
            },
          ],
        },
        tx,
      );
      await tx
        .update(mealItems)
        .set({ nutrientSource: "recipe" })
        .where(and(eq(mealItems.mealId, created.id), isNotNull(mealItems.foodId)));
      return created;
    });
    clearPlannedCache();
    return { ok: true, mealId: meal.id };
  } catch (error) {
    if (error instanceof ManualMealError) return { ok: false, status: 422, error: error.message };
    throw error;
  }
};

// ---- Recipes ----

/** Mealie recipes for a search (empty when Mealie is not connected or does not answer). */
export const searchMealieRecipes = async (
  userId: string,
  query: string,
  dbx: DbOrTx = defaultDb,
): Promise<MealieRecipeHit[]> => {
  const text = query.trim().slice(0, 80);
  if (text.length < 2) return [];
  const row = await getIntegrationRow(userId, "mealie", dbx);
  if (!integrationConfig().mealieBaseUrl || !credentialOf(row) || row?.status === "error")
    return [];
  try {
    const hits = await withMealie(userId, (client) => client.searchRecipes(text, 8), dbx);
    return hits
      .filter((r) => r.id && r.slug)
      .map((r) => ({ id: r.id, slug: r.slug, name: r.name?.trim() || r.slug }));
  } catch {
    return [];
  }
};

export type RecipeResult =
  | { ok: true; recipe: RecipeInfoDto }
  | { ok: false; status: 404 | 409 | 422 | 502 | 503; error: string };

const recipeFailure = (error: unknown): RecipeResult => {
  if (isIntegrationError(error) && error.kind === "not_found")
    return { ok: false, status: 404, error: "This recipe is not in Mealie." };
  const result = failure(error);
  return { ok: false, status: result.status === 422 ? 409 : result.status, error: result.error };
};

const cleanSlug = (value: string) => (/^[\w-]{1,200}$/.test(value) ? value : null);

/** A Mealie recipe, imported into Cal (nutrition from Mealie or computed). */
export const getRecipeInfo = async (
  userId: string,
  slug: string,
  dbx: DbOrTx = defaultDb,
): Promise<RecipeResult> => {
  const clean = cleanSlug(slug);
  if (!clean) return { ok: false, status: 404, error: "This recipe is not in Mealie." };
  try {
    const recipe = await withMealie(userId, (client) => client.recipe(clean), dbx);
    return { ok: true, recipe: await importRecipe(userId, recipe, {}, dbx) };
  } catch (error) {
    return recipeFailure(error);
  }
};

/**
 * "Save nutrition to Mealie": writes Cal's computed values per serving into the recipe's empty
 * nutrition fields. Only this call writes recipes, and only when Mealie's nutrition is empty.
 */
export const saveNutritionToMealie = async (
  userId: string,
  slug: string,
  dbx: DbOrTx = defaultDb,
): Promise<RecipeResult> => {
  const clean = cleanSlug(slug);
  if (!clean) return { ok: false, status: 404, error: "This recipe is not in Mealie." };
  try {
    return await withMealie(
      userId,
      async (client) => {
        const recipe: MealieRecipe = await client.recipe(clean);
        if (!isNutritionEmpty(recipe.nutrition))
          return {
            ok: false as const,
            status: 409 as const,
            error: "Mealie already has nutrition for this recipe; Cal leaves it as it is.",
          };
        const info = await importRecipe(userId, recipe, { force: true }, dbx);
        if (info.nutritionSource !== "computed")
          return {
            ok: false as const,
            status: 422 as const,
            error: "Cal could not compute this recipe's nutrition from its ingredients.",
          };
        const saved = await client.patchNutrition(recipe.slug, nutrientsToMealie(info.perServing));
        const updated = await importRecipe(
          userId,
          {
            ...recipe,
            ...saved,
            nutrition: saved?.nutrition ?? nutrientsToMealie(info.perServing),
          },
          { force: true },
          dbx,
        );
        await audit(
          {
            userId,
            action: "integration.mealie.nutrition",
            targetType: "mealie-recipe",
            targetId: recipe.id,
          },
          dbx,
        );
        return { ok: true as const, recipe: updated };
      },
      dbx,
    );
  } catch (error) {
    return recipeFailure(error);
  }
};

// ---- Meal plan suggestions ----

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PLAN_DAYS = 14;
const MAX_RECIPE_PAGES = 3;
/** Recipe details fetched per suggestion for recipes Cal has not seen. */
const MAX_DETAIL_CALLS = 60;

export type PlanResult =
  | { ok: true; plan: PlanSuggestionDto }
  | { ok: false; status: 400 | 409 | 422 | 502 | 503; error: string };

const cleanDays = (days: unknown, today: string) => {
  if (!Array.isArray(days)) return null;
  const clean = [
    ...new Set(days.filter((d): d is string => typeof d === "string" && DATE.test(d))),
  ].sort();
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 60);
  const last = limit.toISOString().slice(0, 10);
  if (!clean.length || clean.length > MAX_PLAN_DAYS || clean.some((d) => d < today || d > last))
    return null;
  return clean;
};

const cleanSlots = (slots: unknown) => {
  if (!Array.isArray(slots)) return null;
  const clean = PLAN_SLOTS.filter((s) => slots.includes(s));
  return clean.length ? clean : null;
};

/** Recipes with nutrition per serving: Mealie's own, or Cal's computed dish of the recipe. */
const planRecipes = async (userId: string, client: MealieClient, dbx: DbOrTx) => {
  const summaries = [];
  for (let page = 1; page <= MAX_RECIPE_PAGES; page++) {
    const result = await client.recipePage(page, 100);
    summaries.push(...result.items);
    if (page >= result.totalPages) break;
  }
  const out: PlanRecipe[] = [];
  let calls = 0;
  for (const summary of summaries) {
    if (!summary.id || !summary.slug) continue;
    const row = await recipeFoodRow(userId, summary.id, dbx);
    let perServing =
      row && row.servingGrams ? multiply(row.nutrients, row.servingGrams / 100) : null;
    if (!perServing && calls < MAX_DETAIL_CALLS) {
      calls += 1;
      const recipe = await client.recipe(summary.slug).catch(() => null);
      if (recipe && !isNutritionEmpty(recipe.nutrition))
        perServing = mealieToNutrients(recipe.nutrition);
    }
    if (perServing && typeof perServing.energy === "number" && perServing.energy > 0)
      out.push({
        id: summary.id,
        slug: summary.slug,
        name: summary.name?.trim() || summary.slug,
        kcal: perServing.energy,
        protein: perServing.protein ?? 0,
      });
  }
  return out;
};

const multiply = (map: Record<string, number>, factor: number) =>
  Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v * factor])) as Record<
    string,
    number
  >;

/** Suggests recipes for the chosen days and slots; nothing is written. */
export const suggestMealPlan = async (
  userId: string,
  request: Partial<PlanRequestDto>,
  today: string,
  dbx: DbOrTx = defaultDb,
): Promise<PlanResult> => {
  const days = cleanDays(request.days, today);
  const slots = cleanSlots(request.slots);
  if (!days)
    return { ok: false, status: 400, error: `Pick 1 to ${MAX_PLAN_DAYS} days from today on.` };
  if (!slots) return { ok: false, status: 400, error: "Pick at least one meal." };
  const { targets } = await getTargets(userId, dbx);
  const energyTarget = targets.energy?.target ?? 2000;
  const proteinTarget = targets.protein?.target ?? 50;
  try {
    const recipes = await withMealie(userId, (client) => planRecipes(userId, client, dbx), dbx);
    if (!recipes.length)
      return {
        ok: false,
        status: 422,
        error: "None of your Mealie recipes has nutrition yet. Open a recipe in Cal to compute it.",
      };
    return {
      ok: true,
      plan: {
        days: suggestPlan({ days, slots, energyTarget, proteinTarget, recipes }),
        recipesConsidered: recipes.length,
        energyTarget,
        proteinTarget,
      },
    };
  } catch (error) {
    const result = failure(error);
    return { ok: false, status: result.status === 422 ? 409 : result.status, error: result.error };
  }
};

export type ConfirmResult =
  | { ok: true; written: number; failed: number }
  | { ok: false; status: 400 | 409 | 502 | 503; error: string };

/**
 * Writes a confirmed plan to Mealie (POST /api/households/mealplans per entry). Only called after
 * the person confirmed on the screen that says plans are shared with the household.
 */
export const confirmMealPlan = async (
  userId: string,
  entries: unknown,
  today: string,
  dbx: DbOrTx = defaultDb,
): Promise<ConfirmResult> => {
  if (!Array.isArray(entries) || !entries.length || entries.length > MAX_PLAN_DAYS * 4)
    return { ok: false, status: 400, error: "There is nothing to add." };
  const clean: Pick<PlanEntryDto, "date" | "slot" | "recipeId">[] = [];
  for (const raw of entries as Record<string, unknown>[]) {
    const date = typeof raw?.date === "string" ? raw.date : "";
    const slot = raw?.slot;
    const recipeId = typeof raw?.recipeId === "string" ? raw.recipeId : "";
    if (
      !cleanDays([date], today) ||
      !(MEAL_SLOTS as readonly unknown[]).includes(slot) ||
      !/^[\w-]{1,64}$/.test(recipeId)
    )
      return { ok: false, status: 400, error: "One of the plan entries is not valid." };
    clean.push({ date, slot: slot as MealSlot, recipeId });
  }
  try {
    const result = await withMealie(
      userId,
      async (client) => {
        let written = 0;
        let failed = 0;
        for (const entry of clean) {
          try {
            await client.createPlanEntry({
              date: entry.date,
              entryType: mealieEntryType(entry.slot),
              recipeId: entry.recipeId,
            });
            written += 1;
          } catch (error) {
            if (isIntegrationError(error) && error.kind === "auth") throw error;
            failed += 1;
          }
        }
        return { written, failed };
      },
      dbx,
    );
    clearPlannedCache();
    await audit(
      {
        userId,
        action: "integration.mealie.plan",
        targetType: "integration",
        targetId: "mealie",
        details: result,
      },
      dbx,
    );
    return { ok: true, ...result };
  } catch (error) {
    const result = failure(error);
    return { ok: false, status: result.status === 422 ? 409 : result.status, error: result.error };
  }
};

/** Today's local date for a time zone (the server's view of the person's day). */
export const localToday = (tz: string) =>
  localParts(new Date(), isValidTimeZone(tz) ? tz : "UTC").date;
