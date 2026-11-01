// GET /api/foods/:id -> FoodResult (portions included), for the item sheet and the add sheet.
import type { NextRequest } from "next/server";

import { getFood } from "@/lib/food/search";
import { apiUser, errorJson, json } from "@/lib/http/route";

export const dynamic = "force-dynamic";

export const GET = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const food = await getFood((await params).id, user.id);
  if (!food) return errorJson(404, "Not found.");
  return json(food, { headers: { "cache-control": "no-store" } });
};
