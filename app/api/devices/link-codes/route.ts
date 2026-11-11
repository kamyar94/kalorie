// POST /api/devices/link-codes -> 201 { code, expiresAt, intentUrl }
// "Connect Health Connect" inside the app: a one-time code, valid a few minutes, and the intent
// URL that opens the app's native screen with it (the app id comes from ANDROID_APP_ID). The
// phone trades the code for its own token (POST /api/devices/claim). 503 while the server has no
// app id.
import type { NextRequest } from "next/server";

import { androidConfig } from "@/lib/android/config";
import { linkIntentUrl, type LinkCodeDto } from "@/lib/contracts/devices";
import { createLinkCode } from "@/lib/devices/service";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { LINK_CODE_WINDOWS, takeRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const { appId } = androidConfig();
  if (!appId) return errorJson(503, "The Android app is not set up on this server yet.");
  const limit = await takeRateLimit(`link-codes:${user.id}`, LINK_CODE_WINDOWS);
  if (!limit.ok)
    return errorJson(429, "Too many tries in a short time. Try again in an hour.", {
      "retry-after": String(limit.retryAfter),
    });
  const { code, expiresAt } = await createLinkCode(user.id);
  const body: LinkCodeDto = { code, expiresAt, intentUrl: linkIntentUrl(code, appId) };
  return json(body, { status: 201, headers: { "cache-control": "no-store" } });
};
