// GET  /api/foods?q=text&limit=20 -> { foods: FoodResult[], recipes: MealieRecipeHit[] }
//      (search, the person's own first; recipes from Mealie when it is connected)
// POST /api/foods NewFoodInput -> 201 FoodResult               (custom food, only theirs)
import type { NextRequest } from "next/server";

import type { NutrientMap } from "@/lib/contracts/nutrients";
import { createCustomFood } from "@/lib/food/custom-foods";
import { FoodInputError } from "@/lib/food/errors";
import { searchFoods } from "@/lib/food/search";
import { readJsonObject } from "@/lib/http/body";
import { searchMealieRecipes } from "@/lib/integrations/mealie/service";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { SETTINGS_WINDOWS, takeRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export const GET = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const query = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "20");
  const [foods, recipes] = query.trim()
    ? await Promise.all([
        searchFoods({
          query,
          userId: user.id,
          limit: Number.isFinite(limit) ? Math.min(Math.max(1, limit), 50) : 20,
        }),
        searchMealieRecipes(user.id, query),
      ])
    : [[], []];
  return json({ foods, recipes }, { headers: { "cache-control": "no-store" } });
};

export const POST = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const limit = await takeRateLimit(`foods:${user.id}`, SETTINGS_WINDOWS);
  if (!limit.ok) return errorJson(429, "Too many new foods in a short time. Try again later.");
  const body = await readJsonObject(req);
  if (!body) return errorJson(400, "Send the food as JSON.");
  try {
    const nutrients = (
      typeof body.nutrients === "object" && body.nutrients && !Array.isArray(body.nutrients)
        ? body.nutrients
        : {}
    ) as NutrientMap;
    const barcode = typeof body.barcode === "string" && body.barcode.trim() ? body.barcode : null;
    const food = await createCustomFood(user.id, {
      nameEn: typeof body.nameEn === "string" ? body.nameEn : "",
      nameFa: typeof body.nameFa === "string" ? body.nameFa : null,
      brand: typeof body.brand === "string" ? body.brand : null,
      barcode,
      kind: barcode ? "packaged" : "food",
      servingGrams: typeof body.servingGrams === "number" ? body.servingGrams : null,
      ...(body.per === "serving" ? { perServing: nutrients } : { per100g: nutrients }),
    });
    return json(food, 201);
  } catch (err) {
    if (err instanceof FoodInputError) return errorJson(400, err.message);
    throw err;
  }
};
