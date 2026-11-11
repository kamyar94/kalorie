// POST /api/favorites/:mealId/log { eatenAt, tz } -> 201 MealDto: logs a favorite again, a ready
// copy of the meal as it is now, at that time. 404 when the meal is not one of the person's
// favorites.
import type { NextRequest } from "next/server";

import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { logFavorite } from "@/lib/meals/favorites";
import { parseWhen } from "@/lib/meals/parse";
import { isValidTimeZone } from "@/lib/meals/time";

export const dynamic = "force-dynamic";

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ mealId: string }> },
) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonObject(req);
  const when = body && parseWhen(body);
  if (!when) return errorJson(400, "Pick a time in the past year.");
  const tz = isValidTimeZone(when.tz) ? when.tz : user.timeZone;
  const meal = await logFavorite(user.id, (await params).mealId, { eatenAt: when.eatenAt, tz });
  if (!meal) return errorJson(404, "Not found.");
  return json(meal, 201);
};
