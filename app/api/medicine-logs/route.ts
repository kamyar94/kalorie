// GET  /api/medicine-logs?date=YYYY-MM-DD -> MedicineDayDto { logs, due } for that local day
// POST /api/medicine-logs NewMedicineLog { medicineId? | name, strength?, form?, amount?, unit?,
//        takenAt, tz, scanId?, keep? } -> 201 { log, medicine }
// Only the signed-in person's medicines and label photos; others answer 404.
import type { NextRequest } from "next/server";

import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { isLocalDate, isValidTimeZone, localParts } from "@/lib/meals/time";
import { parseMedicineLog } from "@/lib/medicines/parse";
import { logMedicine, medicineDay } from "@/lib/medicines/service";

export const dynamic = "force-dynamic";

export const GET = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const date = req.nextUrl.searchParams.get("date") ?? localParts(new Date(), user.timeZone).date;
  if (!isLocalDate(date)) return errorJson(400, "Give the day as YYYY-MM-DD.");
  return json(await medicineDay(user.id, date), { headers: { "cache-control": "no-store" } });
};

export const POST = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonObject(req, 8192);
  if (!body) return errorJson(400, "Send the medicine as JSON.");
  const input = parseMedicineLog(body);
  if ("error" in input) return errorJson(400, input.error);
  if (!isValidTimeZone(input.tz)) input.tz = user.timeZone;
  const logged = await logMedicine(user.id, input);
  if (!logged) return errorJson(404, "Not found.");
  return json(logged, 201);
};
