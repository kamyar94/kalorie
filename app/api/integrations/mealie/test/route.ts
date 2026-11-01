// POST /api/integrations/mealie/test -> {ok: true}: asks Mealie whether the stored token still
// works. 422 refused (the status in Settings turns to an error), 502/503 as when connecting.
import type { NextRequest } from "next/server";

import { apiUser, errorJson, json } from "@/lib/http/route";
import { testMealie } from "@/lib/integrations/mealie/service";
import { SETTINGS_WINDOWS, takeRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  if (!(await takeRateLimit(`integration:${user.id}`, SETTINGS_WINDOWS)).ok)
    return errorJson(429, "Too many tries. Wait a few minutes.");
  const result = await testMealie(user.id);
  return result.ok ? json({ ok: true }) : errorJson(result.status, result.error);
};
