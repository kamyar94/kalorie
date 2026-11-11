// GET  /api/body-photos -> { sessions: BodySessionDto[] } newest first
// POST /api/body-photos (multipart: photo, pose, takenAt, tz, facing?, source?) -> 201
//        { session, photo }. One full-size photo of one pose; the same pose again that day
//        replaces it. Owner only, rate limited like uploads; never sent to an AI.
import type { NextRequest } from "next/server";

import { listBodySessions, saveBodyPhoto } from "@/lib/body/photos";
import { BODY_PHOTO_LIMITS, isBodyPose } from "@/lib/contracts/body-photos";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { isValidTimeZone } from "@/lib/meals/time";
import { formFiles, uploadTooLarge } from "@/lib/photos/form";
import { PhotoError } from "@/lib/photos/intake";
import { ACCEPTED_UPLOAD_TYPES, sniffImageType } from "@/lib/photos/sniff";
import { takeRateLimit, uploadWindows } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export const GET = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  return json(
    { sessions: await listBodySessions(user.id) },
    { headers: { "cache-control": "no-store" } },
  );
};

export const POST = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  if (uploadTooLarge(req)) return errorJson(413, "The photo is larger than 20 MB.");
  const limit = await takeRateLimit(`body-photos:${user.id}`, uploadWindows());
  if (!limit.ok)
    return errorJson(429, "Too many photos in a short time. Try again later.", {
      "retry-after": String(limit.retryAfter),
    });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errorJson(400, "Send the photo as a form.");
  }
  const [file, ...extra] = formFiles(form, "photo");
  if (!file || extra.length) return errorJson(400, "Send one photo.");
  if (file.size > BODY_PHOTO_LIMITS.maxBytes)
    return errorJson(413, "The photo is larger than 20 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type || !ACCEPTED_UPLOAD_TYPES.includes(type))
    return errorJson(415, "Only JPEG, PNG and WebP photos are accepted.");
  const pose = form.get("pose");
  if (!isBodyPose(pose)) return errorJson(400, "Say which pose this is.");
  const takenAt = new Date(String(form.get("takenAt") ?? ""));
  const now = Date.now();
  if (
    Number.isNaN(takenAt.getTime()) ||
    takenAt.getTime() > now + 10 * 60_000 ||
    takenAt.getTime() < now - 20 * 366 * 86_400_000
  )
    return errorJson(400, "The time of the photo is not valid.");
  const tzValue = form.get("tz");
  const tz = isValidTimeZone(tzValue) ? tzValue : user.timeZone;
  const facing = form.get("facing");
  try {
    const saved = await saveBodyPhoto(user.id, {
      photo: bytes,
      pose,
      takenAt: takenAt.toISOString(),
      tz,
      facing: facing === "user" || facing === "environment" ? facing : null,
      source: form.get("source") === "gallery" ? "gallery" : "camera",
    });
    if (!saved) return errorJson(400, "The photo could not be saved.");
    return json(saved, 201);
  } catch (err) {
    if (err instanceof PhotoError) return errorJson(422, err.message);
    throw err;
  }
};
