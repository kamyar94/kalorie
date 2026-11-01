// GET    /api/meals/:id  -> MealDto (404 for meals that are not the signed-in person's)
// PATCH  /api/meals/:id  MealPatch { eatenAt?, tz?, slot?, title?, note? } -> MealDto
// DELETE /api/meals/:id  -> { ok: true } (soft delete)
import type { NextRequest } from "next/server";

import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { parseMealPatch } from "@/lib/meals/parse";
import { deleteMeal, getMeal, updateMeal } from "@/lib/meals/service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export const GET = async (req: NextRequest, { params }: Context) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const meal = await getMeal(user.id, (await params).id);
  if (!meal) return errorJson(404, "Not found.");
  return json(meal, { headers: { "cache-control": "no-store" } });
};

export const PATCH = async (req: NextRequest, { params }: Context) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonObject(req);
  if (!body) return errorJson(400, "Send the changes as JSON.");
  try {
    const meal = await updateMeal(user.id, (await params).id, parseMealPatch(body));
    if (!meal) return errorJson(404, "Not found.");
    return json(meal);
  } catch (err) {
    return errorJson(400, err instanceof Error ? err.message : "The change was not saved.");
  }
};

export const DELETE = async (req: NextRequest, { params }: Context) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  if (!(await deleteMeal(user.id, (await params).id))) return errorJson(404, "Not found.");
  return json({ ok: true });
};
