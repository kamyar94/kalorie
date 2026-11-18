// POST /api/hints { hint: "phone-steps-only" } -> { ok: true }: closes a hint for the signed-in
// person; it stays closed on every device.
import type { NextRequest } from "next/server";

import { dismissHint, isHintCode } from "@/lib/account/hints";
import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonObject(req, 1024);
  if (!body || !isHintCode(body.hint)) return errorJson(400, "Say which hint to close.");
  await dismissHint(user.id, body.hint);
  return json({ ok: true });
};
