// POST /api/meals/:id/duplicate { eatenAt, tz } -> 201 MealDto: "I ate this again", a ready copy
// of the meal's items at another time (now, or another day).
import type { NextRequest } from "next/server";

import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { parseWhen } from "@/lib/meals/parse";
import { duplicateMeal } from "@/lib/meals/service";
import { isValidTimeZone } from "@/lib/meals/time";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonObject(req);
  const when = body && parseWhen(body);
  if (!when) return errorJson(400, "Pick a time in the past year.");
  const tz = isValidTimeZone(when.tz) ? when.tz : user.timeZone;
  const meal = await duplicateMeal(user.id, (await params).id, { eatenAt: when.eatenAt, tz });
  if (!meal) return errorJson(404, "Not found.");
  return json(meal, 201);
};
