// POST /api/mealie/plan/confirm {entries: [{date, slot, recipeId}]} -> {written, failed}: writes
// the confirmed plan to Mealie (shared with the household). Only the confirm screen calls this.
import type { NextRequest } from "next/server";

import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { confirmMealPlan } from "@/lib/integrations/mealie/service";
import { SETTINGS_WINDOWS, takeRateLimit } from "@/lib/rate-limit";
import { viewerToday } from "@/lib/ui/viewer-time";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  if (!(await takeRateLimit(`mealie-write:${user.id}`, SETTINGS_WINDOWS)).ok)
    return errorJson(429, "Too many changes. Wait a few minutes.");
  const body = await readJsonObject(req);
  const result = await confirmMealPlan(user.id, body?.entries, await viewerToday(user.timeZone));
  return result.ok
    ? json({ written: result.written, failed: result.failed })
    : errorJson(result.status, result.error);
};
