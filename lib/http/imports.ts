// Shared parts of the import routes (POST /api/imports/activities, POST /api/imports/measurements):
// the records of one batch, read from a JSON body, and the rate limit. The file itself never
// reaches the server: the browser reads it and sends only the records (lib/imports).
import { ACTIVITY_LIMITS } from "@/lib/contracts/activities";
import { IMPORT_WINDOWS, takeRateLimit } from "@/lib/rate-limit";

import { readJsonObject } from "./body";
import { errorJson } from "./route";

/** 2,000 records of a few hundred bytes each, with room to spare. */
const MAX_BATCH_BYTES = 2 * 1024 * 1024;

export const takeImport = async (userId: string) => {
  const limit = await takeRateLimit(`imports:${userId}`, IMPORT_WINDOWS);
  return limit.ok
    ? null
    : errorJson(429, "Too many imports in a short time. Try again in an hour.", {
        "retry-after": String(limit.retryAfter),
      });
};

/** The `records` array of the body, or an error answer. */
export const readImportBatch = async (
  req: Request,
): Promise<{ records: unknown[]; error?: undefined } | { error: Response }> => {
  const body = await readJsonObject(req, MAX_BATCH_BYTES);
  if (!body || !Array.isArray(body.records))
    return { error: errorJson(400, "Send the records as JSON.") };
  if (body.records.length > ACTIVITY_LIMITS.importBatch)
    return {
      error: errorJson(413, `Send at most ${ACTIVITY_LIMITS.importBatch} records at a time.`),
    };
  return { records: body.records };
};
