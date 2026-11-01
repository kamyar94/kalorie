// GET /api/push/key -> {publicKey}: the server's VAPID public key for PushManager.subscribe.
// 404 when notifications are not set up on this server.
import type { NextRequest } from "next/server";

import { apiUser, errorJson, json } from "@/lib/http/route";
import { vapidConfig } from "@/lib/push/config";

export const dynamic = "force-dynamic";

export const GET = async (req: NextRequest) => {
  const { error } = await apiUser(req);
  if (error) return error;
  const keys = vapidConfig();
  if (!keys) return errorJson(404, "Notifications are not set up on this server.");
  return json({ publicKey: keys.publicKey }, { headers: { "cache-control": "no-store" } });
};
