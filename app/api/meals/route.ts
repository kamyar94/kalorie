// GET  /api/meals?date=YYYY-MM-DD  -> { meals: MealSummaryDto[] } for that local day
// POST /api/meals (multipart)      -> 201 { meal, duplicate: false } | 200 { meal, duplicate: true }
//   photos   0 to 3 image files (JPEG, PNG or WebP by content), at most 8 MB each, 25 MB in all;
//            no photo makes a text-only meal (source "text"), which needs a note
//   eatenAt  ISO time of the meal (the chosen time, else the first photo)
//   tz       IANA time zone of the device
//   clientId the device queue's id for the meal (repeat uploads return the first copy)
//   note     up to 500 characters; optional with photos, required without
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { UPLOAD_LIMITS } from "@/lib/contracts/meals";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { createPhotoMeal } from "@/lib/meals/create";
import { listMealsForDay } from "@/lib/meals/service";
import { isLocalDate, isValidTimeZone, localParts } from "@/lib/meals/time";
import { formFiles, readUploadedPhotos, uploadTooLarge } from "@/lib/photos/form";
import { PhotoError } from "@/lib/photos/intake";
import { takeRateLimit, uploadWindows } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

export const GET = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const date = req.nextUrl.searchParams.get("date") ?? localParts(new Date(), user.timeZone).date;
  if (!isLocalDate(date)) return errorJson(400, "Give the day as YYYY-MM-DD.");
  return json(
    { meals: await listMealsForDay(user.id, date) },
    {
      headers: { "cache-control": "no-store" },
    },
  );
};

export const POST = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;

  if (uploadTooLarge(req))
    return errorJson(413, "The photos are too large together (25 MB at most).");

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

  const noteField = form.get("note");
  const note =
    typeof noteField === "string" && noteField.trim()
      ? noteField.trim().slice(0, UPLOAD_LIMITS.maxNoteChars)
      : null;

  const files = formFiles(form, "photos");
  // A meal described in words needs no photo, but it needs the words.
  if (!files.length && !note) return errorJson(400, "Add a photo or write what you ate.");
  const checked = await readUploadedPhotos(files);
  if (!checked.ok) return errorJson(checked.status, checked.error);
  const { photos } = checked;

  const eatenAt = new Date(String(form.get("eatenAt") ?? ""));
  const now = Date.now();
  if (
    Number.isNaN(eatenAt.getTime()) ||
    eatenAt.getTime() > now + 10 * 60_000 ||
    eatenAt.getTime() < now - 366 * 86_400_000
  )
    return errorJson(400, "The meal time is missing or not plausible.");

  const profileTz = (
    await db.select({ tz: users.timeZone }).from(users).where(eq(users.id, user.id)).limit(1)
  )[0]?.tz;
  const tzField = String(form.get("tz") ?? "");
  const tz = isValidTimeZone(tzField) ? tzField : (profileTz ?? "UTC");

  const clientIdField = form.get("clientId");
  const clientId =
    typeof clientIdField === "string" && CLIENT_ID.test(clientIdField) ? clientIdField : null;
  try {
    const result = await createPhotoMeal({ userId: user.id, clientId, eatenAt, tz, note, photos });
    return json(result, result.duplicate ? 200 : 201);
  } catch (err) {
    if (err instanceof PhotoError) return errorJson(422, err.message);
    console.error("Upload failed:", err instanceof Error ? err.message : err);
    return errorJson(500, "The meal could not be saved. Try again.");
  }
};
