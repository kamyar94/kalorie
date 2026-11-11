// POST /api/meals/:id/medicine-scan -> 202 MedicineScanDto ("Log as a medicine", step 1)
// For a meal that failed because it shows a medicine or a supplement: a copy of its cover photo
// becomes the person's label photo and the label is read from the meal's photos; GET
// /api/medicine-scans/:id tells when it is done. Without an AI key the scan answers "failed"
// (no-key) at once. 404 for someone else's meal, 409 when the meal is not a medicine or has no
// photo, 422 when its photo files cannot be read. Rate limited like uploads.
import type { NextRequest } from "next/server";

import { apiUser, errorJson, json } from "@/lib/http/route";
import { mealMedicineScan } from "@/lib/medicines/from-meal";
import { takeRateLimit, uploadWindows } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const limit = await takeRateLimit(`upload:${user.id}`, uploadWindows());
  if (!limit.ok)
    return errorJson(429, "Too many photos in a short time. Try again later.", {
      "retry-after": String(limit.retryAfter),
    });
  try {
    const result = await mealMedicineScan(user.id, (await params).id);
    return result.ok ? json(result.value, result.status) : errorJson(result.status, result.error);
  } catch (err) {
    console.error("Label from a meal failed:", err instanceof Error ? err.message : err);
    return errorJson(500, "The photo could not be read. Type the medicine instead.");
  }
};
