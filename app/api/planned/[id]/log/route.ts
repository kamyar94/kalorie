// POST /api/planned/:id/log { servings, eatenAt, tz } -> 201 { mealId }: logs a planned Mealie
// recipe from the Today screen (lib/integrations/mealie/service.ts). 404 unknown plan entry,
// 409 Mealie refuses the saved token, 422 no recipe or no nutrition, 502/503 Mealie unreachable
// or not set up. Logging the same entry again answers its meal.
import type { NextRequest } from "next/server";

import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { logPlannedMeal } from "@/lib/integrations/day";
import { parseWhen } from "@/lib/meals/parse";
import { isValidTimeZone } from "@/lib/meals/time";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonObject(req);
  const when = body && parseWhen(body);
  if (!body || !when) return errorJson(400, "Pick a time in the past year.");
  const servings =
    typeof body.servings === "number" && body.servings > 0 && body.servings <= 20
      ? body.servings
      : 1;
  const logged = await logPlannedMeal(user.id, (await params).id.slice(0, 64), {
    servings,
    eatenAt: when.eatenAt,
    tz: isValidTimeZone(when.tz) ? when.tz : user.timeZone,
  });
  if (!logged.ok) return errorJson(logged.status, logged.error);
  return json({ mealId: logged.mealId }, 201);
};
