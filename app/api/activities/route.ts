// GET  /api/activities?from=YYYY-MM-DD&to=YYYY-MM-DD -> { activities: ActivityDto[] } newest first
// POST /api/activities ManualActivityInput { type, startedAt, tz, durationMin?, intensity?,
//        distanceKm?, steps?, title?, notes? } -> 201 ActivityDto
// Only the signed-in person's activities.
import type { NextRequest } from "next/server";

import { parseManualActivity } from "@/lib/activities/parse";
import { createActivity, listActivities } from "@/lib/activities/service";
import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { isLocalDate } from "@/lib/meals/time";

export const dynamic = "force-dynamic";

export const GET = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if ((from && !isLocalDate(from)) || (to && !isLocalDate(to)))
    return errorJson(400, "Give the days as YYYY-MM-DD.");
  return json(
    { activities: await listActivities(user.id, { from: from ?? undefined, to: to ?? undefined }) },
    { headers: { "cache-control": "no-store" } },
  );
};

export const POST = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonObject(req, 8192);
  if (!body) return errorJson(400, "Send the activity as JSON.");
  const input = parseManualActivity(body);
  if ("error" in input) return errorJson(400, input.error);
  const activity = await createActivity(user.id, input);
  if (!activity) return errorJson(400, "This activity could not be saved.");
  return json(activity, 201);
};
