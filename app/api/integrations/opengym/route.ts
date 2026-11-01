// POST   /api/integrations/opengym {code} -> {ok: true}: redeems an openGym pairing code (made in
//        openGym, valid 5 minutes) for a token, stores it encrypted and reads the data once.
//        400 not a code, 422 refused or expired, 429 too many tries, 502/503 as for Mealie.
// DELETE /api/integrations/opengym -> {ok: true}: forgets the token and the cached data.
import type { NextRequest } from "next/server";

import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { disconnectOpenGym, pairOpenGym } from "@/lib/integrations/opengym/service";
import { takeRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** openGym does not throttle redeeming, so Cal does: 10 codes per 10 minutes per account. */
const PAIR_WINDOWS = [{ name: "10m", windowMs: 600_000, max: 10 }];

export const POST = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  if (!(await takeRateLimit(`opengym-pair:${user.id}`, PAIR_WINDOWS)).ok)
    return errorJson(429, "Too many codes tried. Wait a few minutes.");
  const body = await readJsonObject(req);
  const result = await pairOpenGym(user.id, body?.code);
  return result.ok ? json({ ok: true }) : errorJson(result.status, result.error);
};

export const DELETE = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  await disconnectOpenGym(user.id);
  return json({ ok: true });
};
