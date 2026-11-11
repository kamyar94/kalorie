// POST /api/body/measurements NewMeasurements { localDate, tz, values: [{ code, value, label?,
//        unit? }] } -> 201 { measurements: MeasurementDto[] }
// The signed-in person's own values; a measure logged again on the same day replaces the first.
import type { NextRequest } from "next/server";

import { parseNewMeasurements } from "@/lib/body/parse";
import { logMeasurements } from "@/lib/body/service";
import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { localParts, isValidTimeZone } from "@/lib/meals/time";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonObject(req, 16 * 1024);
  if (!body) return errorJson(400, "Send the measurements as JSON.");
  const tz = isValidTimeZone(body.tz) ? body.tz : user.timeZone;
  // A day ahead is allowed for a person whose clock is ahead of the zone sent.
  const today = localParts(new Date(Date.now() + 86_400_000), tz).date;
  const input = parseNewMeasurements({ ...body, tz }, today);
  if ("error" in input) return errorJson(400, input.error);
  return json({ measurements: await logMeasurements(user.id, input) }, 201);
};
