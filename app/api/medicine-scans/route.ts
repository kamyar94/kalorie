// POST /api/medicine-scans (multipart: photo, one image file) -> 202 MedicineScanDto
// Stores a photo of a medicine's box or blister (the same checks and re-encoding as meal photos)
// and queues its reading by the person's AI provider; GET /api/medicine-scans/:id tells when it
// is done. Without an AI key the scan answers "failed" (no-key) at once. Rate limited like uploads.
import type { NextRequest } from "next/server";

import { apiUser, errorJson, json } from "@/lib/http/route";
import { createMedicineScan } from "@/lib/medicines/scans";
import { formFiles, readUploadedPhotos, uploadTooLarge } from "@/lib/photos/form";
import { PhotoError } from "@/lib/photos/intake";
import { takeRateLimit, uploadWindows } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  if (uploadTooLarge(req)) return errorJson(413, "The photo is too large.");
  const limit = await takeRateLimit(`upload:${user.id}`, uploadWindows());
  if (!limit.ok)
    return errorJson(429, "Too many uploads in a short time. Try again later.", {
      "retry-after": String(limit.retryAfter),
    });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errorJson(400, "The upload could not be read.");
  }
  const files = formFiles(form, "photo");
  if (!files.length) return errorJson(400, "Send a photo of the label.");
  const checked = await readUploadedPhotos(files, 1);
  if (!checked.ok) return errorJson(checked.status, checked.error);
  try {
    return json(await createMedicineScan(user.id, checked.photos[0]!), 202);
  } catch (err) {
    if (err instanceof PhotoError) return errorJson(422, err.message);
    console.error("Label photo failed:", err instanceof Error ? err.message : err);
    return errorJson(500, "The photo could not be saved. Try again.");
  }
};
