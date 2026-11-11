// POST /api/integrations/opengym/sync -> {ok, weighIns, workouts, latestWeight}: reads openGym now.
// 409 before openGym is paired, 503 when this server has no openGym address, 502 when openGym is
// unreachable or signed Kal out; each with a sentence.
import type { NextRequest } from "next/server";

import { apiUser, errorJson, json } from "@/lib/http/route";
import { syncOpenGym } from "@/lib/integrations/opengym/service";
import { SETTINGS_WINDOWS, takeRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  if (!(await takeRateLimit(`integration:${user.id}`, SETTINGS_WINDOWS)).ok)
    return errorJson(429, "Too many tries. Wait a few minutes.");
  const result = await syncOpenGym(user.id);
  if (!result.ok) return errorJson(result.status, result.error);
  return json({
    ok: true,
    weighIns: result.snapshot.weights.length,
    workouts: result.snapshot.workouts.length,
    latestWeight: result.snapshot.latestWeight,
  });
};
