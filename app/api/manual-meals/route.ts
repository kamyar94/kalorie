// POST /api/manual-meals { eatenAt, tz, slot?, title?, items: ItemInput[] } -> 201 MealDto: a meal
// logged without a photo (search, barcode, recent foods), ready at once.
import type { NextRequest } from "next/server";

import type { ItemInput, MealSlot } from "@/lib/contracts/meals";
import { MEAL_SLOTS } from "@/lib/contracts/meals";
import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { createManualMeal, MAX_MANUAL_ITEMS, ManualMealError } from "@/lib/meals/manual";
import { parseItemInput, parseWhen } from "@/lib/meals/parse";
import { isValidTimeZone } from "@/lib/meals/time";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonObject(req);
  if (!body) return errorJson(400, "Send the meal as JSON.");
  const when = parseWhen(body);
  if (!when) return errorJson(400, "Pick a time in the past year.");
  const rawItems = Array.isArray(body.items) ? body.items.slice(0, MAX_MANUAL_ITEMS + 1) : [];
  const items: ItemInput[] = [];
  for (const raw of rawItems) {
    const item =
      typeof raw === "object" && raw !== null
        ? parseItemInput(raw as Record<string, unknown>)
        : null;
    if (!item) return errorJson(400, "Every food needs a name.");
    items.push(item);
  }
  try {
    const meal = await createManualMeal(user.id, {
      eatenAt: when.eatenAt,
      tz: isValidTimeZone(when.tz) ? when.tz : user.timeZone,
      slot: MEAL_SLOTS.includes(body.slot as MealSlot) ? (body.slot as MealSlot) : undefined,
      title: typeof body.title === "string" ? body.title : null,
      items,
    });
    return json(meal, 201);
  } catch (err) {
    if (err instanceof ManualMealError) return errorJson(400, err.message);
    throw err;
  }
};
