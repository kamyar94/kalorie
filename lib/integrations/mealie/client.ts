// Mealie's REST API as Cal uses it. Shapes from the Mealie source (mealie-recipes/mealie, branch
// mealie-next, read 31 Oct 2026); JSON keys are camelCase because every Mealie schema uses
// alias_generator=camelize (mealie/schema/_mealie/mealie_model.py):
//   GET   /api/users/self                          the token's user (connection test)
//   GET   /api/households/mealplans/today           list[ReadPlanEntry]   (controller_mealplan.py)
//   GET   /api/households/mealplans?start_date=&end_date=&perPage=   PlanEntryPagination {items}
//   GET   /api/households/mealplans/{id}            ReadPlanEntry
//   POST  /api/households/mealplans                 CreatePlanEntry -> 201 ReadPlanEntry
//         {date, entryType: breakfast|lunch|dinner|side|snack|drink|dessert, title, text,
//          recipeId, recipeScale}; an entry needs a recipeId or a title (meal_plan/new_meal.py)
//   GET   /api/recipes?search=&page=&perPage=       PaginationBase[RecipeSummary] {items, totalPages}
//   GET   /api/recipes/{slug or id}                 Recipe (recipe/recipe.py): recipeServings,
//         recipeIngredient [{quantity, unit {name, abbreviation}, food {name}, note, display,
//         originalText}] (recipe_ingredient.py), nutrition {calories, proteinContent, ...} as
//         strings or null (recipe_nutrition.py)
//   PATCH /api/recipes/{slug}                       RecipeIn, only the fields sent change
import { callJson, IntegrationError } from "../http";

export type MealieNutritionKey =
  | "calories"
  | "carbohydrateContent"
  | "cholesterolContent"
  | "fatContent"
  | "fiberContent"
  | "proteinContent"
  | "saturatedFatContent"
  | "sodiumContent"
  | "sugarContent"
  | "transFatContent"
  | "unsaturatedFatContent";

export type MealieNutrition = Partial<Record<MealieNutritionKey, string | number | null>>;

export type MealieRecipeSummary = {
  id: string;
  slug: string;
  name: string | null;
  recipeServings?: number | null;
  recipeYieldQuantity?: number | null;
  recipeYield?: string | null;
  updatedAt?: string | null;
  dateUpdated?: string | null;
};

export type MealieUnit = {
  name?: string | null;
  abbreviation?: string | null;
  pluralName?: string | null;
};

export type MealieIngredient = {
  quantity?: number | null;
  unit?: MealieUnit | null;
  food?: { name?: string | null; pluralName?: string | null } | null;
  note?: string | null;
  display?: string | null;
  originalText?: string | null;
  title?: string | null;
};

export type MealieRecipe = MealieRecipeSummary & {
  nutrition?: MealieNutrition | null;
  recipeIngredient?: (MealieIngredient | string)[] | null;
};

export type MealiePlanEntry = {
  id: number;
  date: string;
  entryType: string;
  title?: string | null;
  text?: string | null;
  recipeId?: string | null;
  recipeScale?: number | null;
  recipe?: MealieRecipeSummary | null;
};

export type MealieClient = ReturnType<typeof mealieClient>;

const SERVICE = "Mealie";

const list = <T>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[];
  const items = (value as { items?: unknown } | null)?.items;
  if (Array.isArray(items)) return items as T[];
  throw new IntegrationError("bad_reply", "Mealie sent a list Cal cannot read.");
};

export const mealieClient = (baseUrl: string, token: string, timeoutMs = 8000) => {
  const call = <T>(
    path: string,
    options: { method?: "GET" | "POST" | "PATCH"; body?: unknown } = {},
  ) => callJson<T>(`${baseUrl}${path}`, { ...options, token, timeoutMs, service: SERVICE });
  const q = encodeURIComponent;
  return {
    self: () => call<{ id?: string; username?: string }>("/api/users/self"),
    todayPlan: async () => list<MealiePlanEntry>(await call("/api/households/mealplans/today")),
    plans: async (start: string, end: string) =>
      list<MealiePlanEntry>(
        await call(
          `/api/households/mealplans?start_date=${q(start)}&end_date=${q(end)}&page=1&perPage=100`,
        ),
      ),
    planEntry: (id: string) => call<MealiePlanEntry>(`/api/households/mealplans/${q(id)}`),
    searchRecipes: async (search: string, perPage = 10) =>
      list<MealieRecipeSummary>(
        await call(`/api/recipes?search=${q(search)}&page=1&perPage=${perPage}`),
      ),
    recipePage: async (page: number, perPage = 100) => {
      const body = await call<{ items?: unknown; totalPages?: number }>(
        `/api/recipes?page=${page}&perPage=${perPage}&orderBy=name&orderDirection=asc`,
      );
      return { items: list<MealieRecipeSummary>(body), totalPages: Number(body?.totalPages) || 1 };
    },
    recipe: (slugOrId: string) => call<MealieRecipe>(`/api/recipes/${q(slugOrId)}`),
    createPlanEntry: (entry: { date: string; entryType: string; recipeId: string }) =>
      call<MealiePlanEntry>("/api/households/mealplans", {
        method: "POST",
        body: { ...entry, title: "", text: "", recipeScale: 1 },
      }),
    patchNutrition: (slug: string, nutrition: MealieNutrition) =>
      call<MealieRecipe>(`/api/recipes/${q(slug)}`, { method: "PATCH", body: { nutrition } }),
  };
};
