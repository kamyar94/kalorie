// DELETE /api/medicine-logs/:id -> { ok: true }: removes one of the person's logs (and its label
// photo when no other log uses it). Another person's log answers 404.
import type { NextRequest } from "next/server";

import { apiUser, errorJson, json } from "@/lib/http/route";
import { deleteMedicineLog } from "@/lib/medicines/service";

export const dynamic = "force-dynamic";

export const DELETE = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  if (!(await deleteMedicineLog(user.id, (await params).id))) return errorJson(404, "Not found.");
  return json({ ok: true });
};
