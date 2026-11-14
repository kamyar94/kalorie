// PATCH /api/water/:mealId WaterPatch { ml?, eatenAt?, tz? } -> WaterEntryDto: changes water added
// on its own (a meal of plain water only, as the Today screen's Water card adds it): the amount
// (the item's ml, grams and water nutrient) and the time (a time on another day moves it there).
// Another person's meal answers 404; a meal that is more than water answers 409 (it changes on
// its meal page). New water and removing it go through the meal routes.
import type { NextRequest } from "next/server";

import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { isValidTimeZone } from "@/lib/meals/time";
import { parseWaterPatch } from "@/lib/meals/water";
import { updateWaterEntry } from "@/lib/meals/water-service";

export const dynamic = "force-dynamic";

export const PATCH = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonObject(req, 4096);
  if (!body) return errorJson(400, "Send the changes as JSON.");
  const patch = parseWaterPatch(body);
  if ("error" in patch) return errorJson(400, patch.error);
  // A time zone the server does not know: the person's own, as for new meals.
  if (patch.tz !== undefined && !isValidTimeZone(patch.tz)) patch.tz = user.timeZone;
  const entry = await updateWaterEntry(user.id, (await params).id, patch);
  if (entry === null) return errorJson(404, "Not found.");
  if (entry === "not-water")
    return errorJson(409, "Only water added on its own changes here. Open its meal to change it.");
  return json(entry);
};
