// PATCH  /api/medicine-logs/:id MedicineLogPatch { takenAt?, tz?, amount? } -> MedicineLogDto:
//        changes when one of the person's logs was taken (a time on another day moves it there)
//        and how many, in its own unit.
// DELETE /api/medicine-logs/:id -> { ok: true }: removes one of the person's logs (and its label
//        photo when no other log uses it).
// Another person's log answers 404.
import type { NextRequest } from "next/server";

import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { isValidTimeZone } from "@/lib/meals/time";
import { parseMedicineLogPatch } from "@/lib/medicines/parse";
import { deleteMedicineLog, updateMedicineLog } from "@/lib/medicines/service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export const PATCH = async (req: NextRequest, { params }: Context) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonObject(req, 4096);
  if (!body) return errorJson(400, "Send the changes as JSON.");
  const patch = parseMedicineLogPatch(body);
  if ("error" in patch) return errorJson(400, patch.error);
  // A time zone the server does not know: the person's own, as for a new log.
  if (patch.tz !== undefined && !isValidTimeZone(patch.tz)) patch.tz = user.timeZone;
  const log = await updateMedicineLog(user.id, (await params).id, patch);
  if (!log) return errorJson(404, "Not found.");
  return json(log);
};

export const DELETE = async (req: NextRequest, { params }: Context) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  if (!(await deleteMedicineLog(user.id, (await params).id))) return errorJson(404, "Not found.");
  return json({ ok: true });
};
