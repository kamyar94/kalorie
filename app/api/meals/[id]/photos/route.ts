// The photos of an existing meal (the meal page). Only the meal's owner; another person's meal
// answers 404. Rate limited like uploads. Each answers { meal: MealDto, reanalysed, notice }.
//
// POST  /api/meals/:id/photos (multipart)
//   photos     one or more image files (JPEG, PNG or WebP by content, 8 MB each); the meal holds
//              at most 3 photos in all (409 otherwise)
//   reanalyse  "true" to analyse the meal again from its photos afterwards (default: only the
//              photos change; items and calories stay)
// PATCH /api/meals/:id/photos { cover?: photoId, order?: photoId[], reanalyse?: boolean }
//   cover makes that photo the cover (position 0); order puts the photos in that order.
import type { NextRequest } from "next/server";

import { readJsonObject } from "@/lib/http/body";
import { photosResponse, takePhotoEdit } from "@/lib/http/meal-photos";
import { apiUser, errorJson } from "@/lib/http/route";
import { addMealPhotos, reorderMealPhotos } from "@/lib/meals/photos";
import { formFiles, readUploadedPhotos, uploadTooLarge } from "@/lib/photos/form";
import { PhotoError } from "@/lib/photos/intake";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export const POST = async (req: NextRequest, { params }: Context) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  if (uploadTooLarge(req))
    return errorJson(413, "The photos are too large together (25 MB at most).");
  const limited = await takePhotoEdit(user.id);
  if (limited) return limited;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errorJson(400, "The upload could not be read.");
  }
  const files = formFiles(form, "photos");
  if (!files.length) return errorJson(400, "Choose a photo to add.");
  const checked = await readUploadedPhotos(files);
  if (!checked.ok) return errorJson(checked.status, checked.error);
  try {
    const result = await addMealPhotos(user.id, (await params).id, checked.photos, {
      reanalyse: form.get("reanalyse") === "true",
    });
    return photosResponse(result, 201);
  } catch (err) {
    if (err instanceof PhotoError) return errorJson(422, err.message);
    console.error("Adding photos failed:", err instanceof Error ? err.message : err);
    return errorJson(500, "The photo could not be saved. Try again.");
  }
};

export const PATCH = async (req: NextRequest, { params }: Context) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonObject(req, 4096);
  if (!body) return errorJson(400, "Send the change as JSON.");
  const order =
    typeof body.cover === "string"
      ? [body.cover]
      : Array.isArray(body.order) && body.order.every((id) => typeof id === "string")
        ? (body.order as string[]).slice(0, 10)
        : null;
  if (!order) return errorJson(400, "Say which photo comes first.");
  const limited = await takePhotoEdit(user.id);
  if (limited) return limited;
  return photosResponse(
    await reorderMealPhotos(user.id, (await params).id, order, {
      reanalyse: body.reanalyse === true,
    }),
  );
};
