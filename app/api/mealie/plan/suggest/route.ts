// POST /api/mealie/plan/suggest {days: [YYYY-MM-DD], slots: [breakfast|lunch|dinner|snack]}
// -> PlanSuggestionDto. Reads recipes from Mealie; writes nothing.
import type { NextRequest } from "next/server";

import type { PlanRequestDto } from "@/lib/contracts/integrations";
import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { suggestMealPlan } from "@/lib/integrations/mealie/service";
import { SETTINGS_WINDOWS, takeRateLimit } from "@/lib/rate-limit";
import { viewerToday } from "@/lib/ui/viewer-time";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  if (!(await takeRateLimit(`mealie-plan:${user.id}`, SETTINGS_WINDOWS)).ok)
    return errorJson(429, "Too many plans in a short time. Wait a few minutes.");
  const body = (await readJsonObject(req)) ?? {};
  const result = await suggestMealPlan(
    user.id,
    { days: body.days, slots: body.slots } as Partial<PlanRequestDto>,
    await viewerToday(user.timeZone),
  );
  return result.ok ? json(result.plan) : errorJson(result.status, result.error);
};
