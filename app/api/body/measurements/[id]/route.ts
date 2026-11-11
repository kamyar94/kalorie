// DELETE /api/body/measurements/:id -> {ok}. openGym weigh-ins answer 409 (remove them in
// openGym); another person's value answers 404.
import type { NextRequest } from "next/server";

import { deleteMeasurement } from "@/lib/body/service";
import { apiUser, errorJson, json } from "@/lib/http/route";

export const dynamic = "force-dynamic";

export const DELETE = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const result = await deleteMeasurement(user.id, (await params).id);
  if (result === "not-found") return errorJson(404, "Not found.");
  if (result === "synced")
    return errorJson(409, "This weigh-in comes from openGym. Remove it there and sync again.");
  return json({ ok: true });
};
