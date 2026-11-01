// GET /api/mealie/recipes/:slug -> RecipeInfoDto: the recipe with its nutrition per serving, from
// Mealie or computed from its ingredients (then kept in Cal as a dish marked "computed"), and its
// food row for logging. 404 unknown, 409 Mealie refuses the token, 502/503 unreachable or not set up.
import type { NextRequest } from "next/server";

import { apiUser, errorJson, json } from "@/lib/http/route";
import { getRecipeInfo } from "@/lib/integrations/mealie/service";

export const dynamic = "force-dynamic";

export const GET = async (req: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const result = await getRecipeInfo(user.id, (await params).slug);
  return result.ok
    ? json(result.recipe, { headers: { "cache-control": "no-store" } })
    : errorJson(result.status, result.error);
};
