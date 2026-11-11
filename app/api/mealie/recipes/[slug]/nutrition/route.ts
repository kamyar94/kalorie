// POST /api/mealie/recipes/:slug/nutrition -> RecipeInfoDto: "Save nutrition to Mealie". Writes
// Kal's computed values per serving into the recipe, only when Mealie's nutrition is empty
// (409 when it is not). The only route that changes a Mealie recipe.
import type { NextRequest } from "next/server";

import { apiUser, errorJson, json } from "@/lib/http/route";
import { saveNutritionToMealie } from "@/lib/integrations/mealie/service";
import { SETTINGS_WINDOWS, takeRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  if (!(await takeRateLimit(`mealie-write:${user.id}`, SETTINGS_WINDOWS)).ok)
    return errorJson(429, "Too many changes. Wait a few minutes.");
  const result = await saveNutritionToMealie(user.id, (await params).slug);
  return result.ok ? json(result.recipe) : errorJson(result.status, result.error);
};
