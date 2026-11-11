// DELETE /api/activities/:id -> {ok}. openGym workouts answer 409 (remove them in openGym, the
// next sync removes them here); another person's activity answers 404.
import type { NextRequest } from "next/server";

import { deleteActivity } from "@/lib/activities/service";
import { apiUser, errorJson, json } from "@/lib/http/route";

export const dynamic = "force-dynamic";

export const DELETE = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const result = await deleteActivity(user.id, (await params).id);
  if (result === "not-found") return errorJson(404, "Not found.");
  if (result === "synced")
    return errorJson(409, "This workout comes from openGym. Remove it there and sync again.");
  return json({ ok: true });
};
