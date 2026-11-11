// Shared parts of the routes the Android app calls with its device token instead of the session
// cookie (GET/DELETE /api/devices/self, POST /api/health-connect/sync). A browser never adds the
// token by itself, so these routes need no same-origin check; the proxy lets them through.
import { errorJson } from "@/lib/http/route";

import { deviceForToken, type DeviceOwner } from "./service";

/** What the app shows for any 401: the phone was unlinked (or never was). */
export const UNLINKED = "Unlinked. Link again.";

const unlinked = () => errorJson(401, UNLINKED, { "www-authenticate": 'Bearer realm="kal"' });

/** The linked phone behind `Authorization: Bearer <token>`, or a 401 to return. */
export const deviceFromRequest = async (
  req: Request,
): Promise<{ owner: DeviceOwner; error?: undefined } | { owner?: undefined; error: Response }> => {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization")?.trim() ?? "");
  const owner = match ? await deviceForToken(match[1]!) : null;
  return owner ? { owner } : { error: unlinked() };
};

/** The caller's address as the tunnel reports it (for the claim route's rate limit). */
export const requestIp = (req: Request) =>
  (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local"
  ).slice(0, 64);
