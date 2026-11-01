// Today's planned Mealie recipes, as an input of the photo analysis (docs/DESIGN.md section 8).
// The worker registers the Mealie source once at start-up (installWorkerHooks in worker/handlers.ts):
//   setPlannedRecipesSource(async (userId, localDate) => [...recipes planned that day])
// Without it, and whenever the source fails, the list is empty and the analysis runs without it.
import type { PlannedRecipe, PlannedRecipesSource } from "@/lib/contracts/analysis";

const none: PlannedRecipesSource = async () => [];
let source: PlannedRecipesSource = none;

/** Sets where planned recipes come from; null restores the empty default. */
export const setPlannedRecipesSource = (next: PlannedRecipesSource | null) => {
  source = next ?? none;
};

/** At most 20 planned recipes of the day; never throws. */
export const getPlannedRecipes = async (
  userId: string,
  localDate: string,
): Promise<PlannedRecipe[]> => {
  try {
    const recipes = await source(userId, localDate);
    return (Array.isArray(recipes) ? recipes : [])
      .filter((r) => r && typeof r.id === "string" && typeof r.name === "string" && r.name.trim())
      .slice(0, 20);
  } catch {
    return [];
  }
};
