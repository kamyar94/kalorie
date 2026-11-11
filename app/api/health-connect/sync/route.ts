// POST /api/health-connect/sync with `Authorization: Bearer <device token>`
//   { tz, appVersion, steps, workouts, body, height, restingHeartRate, sleep, deleted }
//   -> { added, updated, removed, skipped }
// A batch of Health Connect records from the Kal Android app (CONTRACT:
// lib/contracts/health-connect.ts). Records are stored once per Health Connect id, so sending
// again updates; `deleted` removes. 401 "Unlinked. Link again." for an unlinked phone, 413 for a
// batch over the limits, 429 past HEALTH_CONNECT_RATE_PER_HOUR batches an hour per phone.
import { HEALTH_CONNECT_LIMITS } from "@/lib/contracts/health-connect";
import { deviceFromRequest } from "@/lib/devices/http";
import { parseSyncBatch } from "@/lib/health-connect/parse";
import { applyHealthConnectBatch } from "@/lib/health-connect/sync";
import { errorJson, json } from "@/lib/http/route";
import { healthConnectWindows, takeRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const TOO_BIG = "The batch is too large. Send fewer records at a time.";

export const POST = async (req: Request) => {
  const { owner, error } = await deviceFromRequest(req);
  if (error) return error;
  const limit = await takeRateLimit(`hc-sync:${owner.device.id}`, healthConnectWindows());
  if (!limit.ok)
    return errorJson(429, "Too many batches in a short time. Kal tries again later.", {
      "retry-after": String(limit.retryAfter),
    });
  if (Number(req.headers.get("content-length") ?? "0") > HEALTH_CONNECT_LIMITS.bodyBytes)
    return errorJson(413, TOO_BIG);
  let text: string;
  try {
    text = await req.text();
  } catch {
    return errorJson(400, "Send the records as JSON.");
  }
  if (text.length > HEALTH_CONNECT_LIMITS.bodyBytes) return errorJson(413, TOO_BIG);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return errorJson(400, "Send the records as JSON.");
  }
  const parsed = parseSyncBatch(raw);
  if ("error" in parsed) return errorJson(parsed.tooLarge ? 413 : 400, parsed.error);
  const result = await applyHealthConnectBatch(owner, parsed);
  return json(result, { headers: { "cache-control": "no-store" } });
};
