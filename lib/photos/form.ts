// The checks every photo upload route makes before sharp sees the bytes: how many files, the size
// of each and of all together, and the type by content (JPEG, PNG or WebP; HEIC is converted on
// the device). Used by POST /api/meals, POST /api/meals/:id/photos and the medicine label photo.
import { UPLOAD_LIMITS } from "@/lib/contracts/meals";

import { ACCEPTED_UPLOAD_TYPES, sniffImageType } from "./sniff";

export type UploadCheck =
  { ok: true; photos: Buffer[] } | { ok: false; status: 400 | 413 | 415; error: string };

/** True when the Content-Length alone is already too large for any photo upload. */
export const uploadTooLarge = (req: Request) =>
  Number(req.headers.get("content-length") ?? "0") > UPLOAD_LIMITS.maxRequestBytes + 64 * 1024;

/** The image files of a form field, read and checked; at most `max` of them. */
export const readUploadedPhotos = async (
  files: File[],
  max: number = UPLOAD_LIMITS.maxPhotos,
): Promise<UploadCheck> => {
  if (files.length > max)
    return {
      ok: false,
      status: 400,
      error:
        max === 1 ? "Send one photo." : `Send at most ${UPLOAD_LIMITS.maxPhotos} photos per meal.`,
    };
  let total = 0;
  const photos: Buffer[] = [];
  for (const file of files) {
    if (file.size > UPLOAD_LIMITS.maxPhotoBytes)
      return { ok: false, status: 413, error: "A photo is larger than 8 MB." };
    total += file.size;
    if (total > UPLOAD_LIMITS.maxRequestBytes)
      return {
        ok: false,
        status: 413,
        error: "The photos are too large together (25 MB at most).",
      };
    const bytes = Buffer.from(await file.arrayBuffer());
    const type = sniffImageType(bytes);
    if (!type || !ACCEPTED_UPLOAD_TYPES.includes(type))
      return { ok: false, status: 415, error: "Only JPEG, PNG and WebP photos are accepted." };
    photos.push(bytes);
  }
  return { ok: true, photos };
};

/** The File values of a form field. */
export const formFiles = (form: FormData, name: string) =>
  form.getAll(name).filter((value): value is File => value instanceof File);
