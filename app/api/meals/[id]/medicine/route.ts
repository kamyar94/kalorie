// POST /api/meals/:id/medicine NewMedicineLog { name, strength?, form?, amount?, unit?,
//        ingredients?, takenAt, tz, scanId?, keep? } -> 201 { log, medicine }
// "Log as a medicine", step 2: logs the medicine a failed not-food meal shows and removes the meal
// (its photos go too; the label photo stays with the log). The same request again with the same
// scanId answers 200 with the first log. 404 for someone else's meal, 409 when the meal is not a
// medicine or a supplement.
import type { NextRequest } from "next/server";

import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { logMealAsMedicine } from "@/lib/medicines/from-meal";
import { parseMedicineLog } from "@/lib/medicines/parse";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonObject(req, 8192);
  if (!body) return errorJson(400, "Send the medicine as JSON.");
  const input = parseMedicineLog(body);
  if ("error" in input) return errorJson(400, input.error);
  const result = await logMealAsMedicine(user.id, (await params).id, input);
  return result.ok ? json(result.value, result.status) : errorJson(result.status, result.error);
};
