// POST /api/items/:id/remember -> { ok: true }: the person corrected this item; Cal keeps the
// corrected food and amount in food_memory so the next photo of the same dish starts from it
// (lib/analysis/memory.ts). The item sheet sends this once when it closes after changes; edits
// already remember the item, and repeated calls for the same meal count once.
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { mealItems } from "@/db/schema";
import { rememberItem } from "@/lib/analysis/memory";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { isUuid } from "@/lib/meals/service";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const itemId = (await params).id;
  if (!isUuid(itemId)) return errorJson(404, "Not found.");
  const own = await db
    .select({ id: mealItems.id })
    .from(mealItems)
    .where(and(eq(mealItems.id, itemId), eq(mealItems.userId, user.id)))
    .limit(1);
  if (!own[0]) return errorJson(404, "Not found.");
  await rememberItem(user.id, itemId);
  return json({ ok: true });
};
