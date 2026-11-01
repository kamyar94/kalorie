// POST   /api/push/subscriptions PushSubscriptionJSON {endpoint, keys {p256dh, auth}} -> 201 {ok}
//        400 unusable subscription (endpoint not on a known push service), 503 not set up.
// DELETE /api/push/subscriptions {endpoint} -> {ok}: this device stops getting notifications.
import type { NextRequest } from "next/server";

import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { removeSubscription, saveSubscription } from "@/lib/push/service";
import { SETTINGS_WINDOWS, takeRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  if (!(await takeRateLimit(`push:${user.id}`, SETTINGS_WINDOWS)).ok)
    return errorJson(429, "Too many changes. Wait a few minutes.");
  const body = await readJsonObject(req, 4096);
  const result = await saveSubscription(user.id, body ?? {}, req.headers.get("user-agent"));
  return result.ok ? json({ ok: true }, 201) : errorJson(result.status, result.error);
};

export const DELETE = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonObject(req, 4096);
  await removeSubscription(user.id, body?.endpoint);
  return json({ ok: true });
};
