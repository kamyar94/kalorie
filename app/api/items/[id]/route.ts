// PATCH  /api/items/:id ItemPatch { grams?, ml?, count?, portionText?, foodId?, name?, nutrients? }
//   -> MealItemDto with its nutrients rescaled at once (and the meal totals updated)
// DELETE /api/items/:id -> { ok: true }
import type { NextRequest } from "next/server";

import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { parseItemPatch } from "@/lib/meals/parse";
import { deleteItem, updateItem } from "@/lib/meals/service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export const PATCH = async (req: NextRequest, { params }: Context) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonObject(req);
  if (!body) return errorJson(400, "Send the changes as JSON.");
  const patch = parseItemPatch(body);
  if (!Object.keys(patch).length) return errorJson(400, "Nothing to change.");
  const item = await updateItem(user.id, (await params).id, patch);
  if (!item) return errorJson(404, "Not found.");
  return json(item);
};

export const DELETE = async (req: NextRequest, { params }: Context) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  if (!(await deleteItem(user.id, (await params).id))) return errorJson(404, "Not found.");
  return json({ ok: true });
};
