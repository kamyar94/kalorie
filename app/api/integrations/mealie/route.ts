// POST   /api/integrations/mealie {token} -> {ok: true}: tests the Mealie API token, then stores it
//        encrypted. 400 empty or malformed, 422 Mealie refused it, 429 too many tries,
//        502 Mealie unreachable, 503 Mealie is not set up on this server.
// DELETE /api/integrations/mealie -> {ok: true}: forgets the token.
import type { NextRequest } from "next/server";

import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { connectMealie, disconnectMealie } from "@/lib/integrations/mealie/service";
import { SETTINGS_WINDOWS, takeRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  if (!(await takeRateLimit(`integration:${user.id}`, SETTINGS_WINDOWS)).ok)
    return errorJson(429, "Too many tries. Wait a few minutes.");
  const body = await readJsonObject(req);
  const result = await connectMealie(user.id, body?.token);
  return result.ok ? json({ ok: true }) : errorJson(result.status, result.error);
};

export const DELETE = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  await disconnectMealie(user.id);
  return json({ ok: true });
};
