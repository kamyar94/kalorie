// Photo files under PHOTO_ROOT (a bind-mounted folder in the Docker stack; ./data/photos in
// development). Layout: <userId>/<yyyy>/<mm>/<photoId>-<variant>.jpg. The database keeps the
// relative paths; every read resolves them inside the root and refuses anything outside it.
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PhotoVariant } from "./intake";

export const photoRoot = () =>
  path.resolve(
    /*turbopackIgnore: true*/ process.env.PHOTO_ROOT || path.join(process.cwd(), "data", "photos"),
  );

const SAFE_SEGMENT = /^[A-Za-z0-9-]+$/;

/** The relative path of one stored variant. */
export const photoRelativePath = (
  userId: string,
  photoId: string,
  variant: PhotoVariant,
  at: Date,
) => {
  if (!SAFE_SEGMENT.test(userId) || !SAFE_SEGMENT.test(photoId))
    throw new Error("Unsafe photo id.");
  const yyyy = String(at.getUTCFullYear());
  const mm = String(at.getUTCMonth() + 1).padStart(2, "0");
  return `${userId}/${yyyy}/${mm}/${photoId}-${variant}.jpg`;
};

/** The relative path of a body photo variant: <userId>/body/<yyyy>/<mm>/<id>-<variant>.jpg. */
export const bodyPhotoRelativePath = (
  userId: string,
  photoId: string,
  variant: "original" | "view" | "thumb",
  at: Date,
) => {
  if (!SAFE_SEGMENT.test(userId) || !SAFE_SEGMENT.test(photoId))
    throw new Error("Unsafe photo id.");
  const yyyy = String(at.getUTCFullYear());
  const mm = String(at.getUTCMonth() + 1).padStart(2, "0");
  return `${userId}/body/${yyyy}/${mm}/${photoId}-${variant}.jpg`;
};

/** The absolute path of a stored relative path, or null when it would leave the root. */
export const resolvePhotoPath = (relative: string) => {
  const root = photoRoot();
  if (!relative || path.isAbsolute(relative) || relative.includes("\0")) return null;
  const full = path.resolve(root, relative);
  return full.startsWith(root + path.sep) ? full : null;
};

/** Writes a file atomically (temporary name, then rename). */
export const writePhotoFile = async (relative: string, data: Buffer) => {
  const full = resolvePhotoPath(relative);
  if (!full) throw new Error("Unsafe photo path.");
  await mkdir(/*turbopackIgnore: true*/ path.dirname(full), { recursive: true });
  const temp = `${full}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ temp, data, { mode: 0o640 });
  await rename(/*turbopackIgnore: true*/ temp, full);
};

export const readPhotoFile = async (relative: string) => {
  const full = resolvePhotoPath(relative);
  if (!full) return null;
  try {
    return await readFile(/*turbopackIgnore: true*/ full);
  } catch {
    return null;
  }
};

export const photoFileSize = async (relative: string) => {
  const full = resolvePhotoPath(relative);
  if (!full) return null;
  try {
    return (await stat(/*turbopackIgnore: true*/ full)).size;
  } catch {
    return null;
  }
};

/** Removes files; missing files are fine. */
export const removePhotoFiles = async (relatives: string[]) => {
  await Promise.all(
    relatives.map(async (relative) => {
      const full = resolvePhotoPath(relative);
      if (full) await rm(/*turbopackIgnore: true*/ full, { force: true });
    }),
  );
};
