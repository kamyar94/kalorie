// GET /api/me -> { id }: the signed-in account's id. The service worker asks before it sends
// meals waiting on the device, so a meal is only ever uploaded into the account that took it.
import type { NextRequest } from "next/server";

import { apiUser, json } from "@/lib/http/route";

export const dynamic = "force-dynamic";

export const GET = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  return json({ id: user.id }, { headers: { "cache-control": "no-store" } });
};
