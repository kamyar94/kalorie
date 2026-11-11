// POST /api/devices/claim { code, name, appVersion } -> 201 { token, device }
// Called by the Android app (no session): trades a one-time link code for the phone's long-lived
// token, which is in this answer only and never in a URL. A wrong, used or expired code answers
// 400; the attempts count against the caller's address.
import type { NextRequest } from "next/server";

import { claimLinkCode } from "@/lib/devices/service";
import { requestIp } from "@/lib/devices/http";
import { readJsonObject } from "@/lib/http/body";
import { errorJson, json } from "@/lib/http/route";
import { CLAIM_IP_WINDOWS, takeRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest) => {
  const limit = await takeRateLimit(`claim-ip:${requestIp(req)}`, CLAIM_IP_WINDOWS);
  if (!limit.ok)
    return errorJson(429, "Too many tries in a short time. Wait 15 minutes and try again.", {
      "retry-after": String(limit.retryAfter),
    });
  const body = await readJsonObject(req, 4096);
  if (!body) return errorJson(400, "Send the code as JSON.");
  const result = await claimLinkCode(body.code, { name: body.name, appVersion: body.appVersion });
  if (result === "invalid" || result === "disabled")
    return errorJson(
      400,
      "This link has expired or was used. Go back to Kal and tap Connect Health Connect again.",
    );
  if (result === "too-many")
    return errorJson(409, "This account has too many linked phones. Unlink one in Kal first.");
  return json(result, { status: 201, headers: { "cache-control": "no-store" } });
};
