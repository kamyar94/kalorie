// POST /api/meals/:id/items ItemInput { name, foodId?, grams?, ml?, count?, portionText?, ... }
//   -> 201 MealItemDto. Nutrients come from the food when one is given.
import type { NextRequest } from "next/server";

import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { parseItemInput } from "@/lib/meals/parse";
import { addItem } from "@/lib/meals/service";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonObject(req);
  const input = body && parseItemInput(body);
  if (!input) return errorJson(400, "Pick a food or give the item a name.");
  const item = await addItem(user.id, (await params).id, input);
  if (!item) return errorJson(404, "Not found.");
  return json(item, 201);
};
