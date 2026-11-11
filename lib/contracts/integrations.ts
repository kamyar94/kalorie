// CONTRACT: what the screens show from Mealie and openGym (docs/DESIGN.md sections 7 and 8), and
// the notification switch (section 9). Client-safe types only.
//
// Server functions, every one scoped by the signed-in user's id:
//   lib/integrations/day.ts
//     getDayPlan(userId, localDate)        -> DayPlan            planned Mealie meals + workouts
//     getWeightHistory(userId, from, to)   -> WeightPointDto[]   oldest first, from openGym
//     getIntegrationStatuses(userId)       -> IntegrationStatusDto[]
//     logPlannedMeal(userId, plannedId, { servings, eatenAt, tz }) -> LogPlannedResult
//   lib/integrations/mealie/service.ts     connect/test/disconnect, recipes, plan suggestions
//   lib/integrations/opengym/service.ts    pair/sync/disconnect, workouts, weigh-ins
//   lib/push/service.ts                    subscriptions and sending
//
// Browser helpers (lib/push/client.ts):
//   pushSupport()        -> PushSupport
//   enablePush()         -> PushResult   asks for permission, subscribes, stores it on the server
//   disablePush()        -> PushResult
//
// HTTP routes (JSON, same-origin checked, the signed-in person's data only):
//   POST   /api/integrations/mealie            {token}          connect (tests the token first)
//   POST   /api/integrations/mealie/test                        test the stored token
//   DELETE /api/integrations/mealie                             forget the token
//   POST   /api/integrations/opengym           {code}           redeem a pairing code
//   POST   /api/integrations/opengym/sync                       read weigh-ins and workouts now
//   DELETE /api/integrations/opengym                            forget the token
//   GET    /api/mealie/recipes/:slug                            RecipeInfoDto (imports it)
//   POST   /api/mealie/recipes/:slug/nutrition                  "Save nutrition to Mealie"
//   POST   /api/mealie/plan/suggest            PlanRequestDto   -> PlanSuggestionDto
//   POST   /api/mealie/plan/confirm            {entries}        -> {written, failed}
//   POST   /api/planned/:id/log                {servings, eatenAt, tz} -> 201 {mealId}
//   GET    /api/push/key                                        {publicKey} or 404
//   POST   /api/push/subscriptions             PushSubscriptionJSON
//   DELETE /api/push/subscriptions             {endpoint}
import type { FoodResult } from "./food-search";
import type { MealSlot } from "./meals";
import type { NutrientMap } from "./nutrients";

export type IntegrationKind = "mealie" | "opengym";

export type IntegrationStatusDto = {
  kind: IntegrationKind;
  /** The server has an address for this integration (MEALIE_BASE_URL, OPENGYM_BASE_URL). */
  available: boolean;
  /** A credential is stored. */
  connected: boolean;
  status: "ok" | "error" | "disconnected";
  /** A short sentence for the person when status is "error". */
  message: string | null;
  lastSyncAt: string | null;
  /** openGym: the latest weigh-in, which the targets use. */
  latestWeight: WeightPointDto | null;
};

/** A recipe planned in Mealie for the day, logged with one tap. */
export type PlannedMealDto = {
  /** Mealie's plan entry id. */
  id: string;
  recipeId: string | null;
  /** The recipe's slug in Mealie, for the recipe sheet. */
  recipeSlug: string | null;
  name: string;
  slot: MealSlot | null;
  /** Energy of one serving when Mealie (or Kal's computed values) knows it. */
  kcalPerServing: number | null;
  /** Servings suggested by the plan (default 1). */
  servings: number;
  /** Already logged. */
  logged: boolean;
};

/** A workout from openGym with an energy estimate (MET x body weight x duration). */
export type WorkoutDto = {
  id: string;
  /** Local day, YYYY-MM-DD. */
  date: string;
  /** Local wall-clock start, HH:MM, when known. */
  startTime: string | null;
  name: string;
  durationMin: number;
  /** Labelled "estimate" wherever it is shown. */
  kcalEstimate: number | null;
  exercises: string[];
};

export type DayPlan = {
  planned: PlannedMealDto[];
  workouts: WorkoutDto[];
  /** Mealie is connected, so the Today screen can offer "Plan meals". */
  mealieConnected: boolean;
};

export type WeightPointDto = { date: string; kg: number };

export type LogPlannedResult =
  { ok: true; mealId: string } | { ok: false; status: 404 | 409 | 422 | 502 | 503; error: string };

/** A Mealie recipe found by search (Add screen, item sheet). */
export type MealieRecipeHit = { id: string; slug: string; name: string };

/**
 * Where a Mealie recipe's nutrition comes from: Mealie's own fields, Kal's computation from the
 * ingredients (kept as a dish marked "computed"), or nothing usable.
 */
export type RecipeNutritionSource = "mealie" | "computed" | "none";

/** A Mealie recipe as Kal sees it, with its food row for logging. */
export type RecipeInfoDto = {
  id: string;
  slug: string;
  name: string;
  /** Servings the recipe makes in Mealie (at least 1). */
  servings: number;
  nutritionSource: RecipeNutritionSource;
  /** Nutrients of one serving (empty when the source is "none"). */
  perServing: NutrientMap;
  /** Grams of one serving: from the ingredients when known, else a nominal 300 g. */
  servingGrams: number;
  /** How many ingredients matched foods in Kal. */
  ingredients: { total: number; matched: number };
  /** Mealie's nutrition is empty and Kal has computed values: "Save nutrition to Mealie". */
  canSaveToMealie: boolean;
  /** The food row in Kal (source "mealie"), null when the source is "none". */
  food: FoodResult | null;
};

export const PLAN_SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

export type PlanRequestDto = { days: string[]; slots: MealSlot[] };

export type PlanEntryDto = {
  date: string;
  slot: MealSlot;
  recipeId: string;
  recipeSlug: string;
  name: string;
  kcal: number;
  protein: number;
};

export type PlanDayDto = {
  date: string;
  entries: PlanEntryDto[];
  kcal: number;
  protein: number;
  /** The day's energy target for the chosen slots, and the protein it should reach. */
  energyBudget: number;
  proteinMin: number;
  /** Within the energy budget and at or above the protein minimum. */
  meetsTargets: boolean;
};

export type PlanSuggestionDto = {
  days: PlanDayDto[];
  /** Recipes with nutrition the search could choose from. */
  recipesConsidered: number;
  /** The day targets used. */
  energyTarget: number;
  proteinTarget: number;
};

export type PushSupport =
  /** The browser can subscribe now. */
  | "supported"
  /** iOS: only from the app on the Home Screen. */
  | "needs-install"
  /** The browser has no Web Push, or the server has no VAPID keys yet. */
  | "unsupported";

export type PushResult = { ok: boolean; message?: string };

/** What a notification carries (encrypted for the device; the service worker shows it). */
export type PushMessage = { title: string; body: string; url: string; tag: string };
