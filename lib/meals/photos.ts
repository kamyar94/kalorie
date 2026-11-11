// Changing the photos of a meal that already exists (the meal page): add one or more, remove one,
// or choose the cover (the photo at position 0, which the timeline card and the meal header
// show). Any meal can get photos, also one typed in words or put together by hand; its source
// stays what it was.
//
// By default only the photos change: items, calories and the analysis stay as they are. With
// reanalyse the meal is analysed again from its photos (and note) afterwards, keeping the items the
// person changed by hand, as "fix with a sentence" does (lib/analysis/requests.ts).
//
// Files are written before their rows and removed after their rows are gone, so a failure leaves
// at most a file nobody points at, never a row without its file. Every function is scoped by the
// signed-in person's id: someone else's meal behaves like a missing one.
import crypto from "node:crypto";

import { and, asc, eq, isNull } from "drizzle-orm";

import { db as defaultDb, type DbOrTx, type Tx } from "@/db";
import { mealPhotos, meals } from "@/db/schema";
import { retryAnalysis } from "@/lib/analysis/requests";
import { UPLOAD_LIMITS, type MealDto } from "@/lib/contracts/meals";
import { processPhoto, type PhotoVariant } from "@/lib/photos/intake";
import { photoRelativePath, removePhotoFiles, writePhotoFile } from "@/lib/photos/storage";

import { getMeal, isUuid } from "./service";

export type MealPhotosResult =
  | {
      ok: true;
      meal: MealDto;
      /** The meal was queued for a new analysis. */
      reanalysed: boolean;
      /** Why a requested new analysis did not start, in words for the person. */
      notice: string | null;
    }
  | { ok: false; status: 400 | 404 | 409 | 429; error: string };

const notFound = { ok: false as const, status: 404 as const, error: "Meal not found." };

/** The meal row, locked for this transaction; null when it is not the person's. */
const lockMeal = async (tx: Tx, userId: string, mealId: string) =>
  (
    await tx
      .select({ id: meals.id })
      .from(meals)
      .where(and(eq(meals.id, mealId), eq(meals.userId, userId), isNull(meals.deletedAt)))
      .for("update")
      .limit(1)
  )[0] ?? null;

const photosOf = (tx: Tx, mealId: string) =>
  tx
    .select()
    .from(mealPhotos)
    .where(eq(mealPhotos.mealId, mealId))
    .orderBy(asc(mealPhotos.position), asc(mealPhotos.createdAt));

/**
 * Writes positions 0, 1, 2... in the given order. Two steps, because (meal_id, position) is
 * unique and checked row by row: first out of the way (negative), then into place.
 */
const writePositions = async (tx: Tx, mealId: string, orderedIds: string[]) => {
  for (const [index, id] of orderedIds.entries())
    await tx
      .update(mealPhotos)
      .set({ position: -1 - index })
      .where(and(eq(mealPhotos.id, id), eq(mealPhotos.mealId, mealId)));
  for (const [index, id] of orderedIds.entries())
    await tx
      .update(mealPhotos)
      .set({ position: index })
      .where(and(eq(mealPhotos.id, id), eq(mealPhotos.mealId, mealId)));
};

/** After a change: the meal, analysed again when asked (and possible). */
const finish = async (
  userId: string,
  mealId: string,
  reanalyse: boolean,
  dbx: DbOrTx,
): Promise<MealPhotosResult> => {
  let reanalysed = false;
  let notice: string | null = null;
  if (reanalyse) {
    const result = await retryAnalysis(userId, mealId, {}, dbx);
    if (result.ok) reanalysed = true;
    else
      notice =
        result.status === 409
          ? "The meal has no photos left to analyse, so its items stay as they are."
          : result.status === 429
            ? "The photos changed, but Cal was asked to analyse too often. Try again in a few minutes."
            : result.error;
  }
  const meal = await getMeal(userId, mealId, dbx);
  return meal ? { ok: true, meal, reanalysed, notice } : notFound;
};

/**
 * Adds photos (already checked for size and type) after the meal's last one. A meal holds at most
 * UPLOAD_LIMITS.maxPhotos. Throws PhotoError for a photo that cannot be read.
 */
export const addMealPhotos = async (
  userId: string,
  mealId: string,
  photos: Buffer[],
  options: { reanalyse?: boolean } = {},
  dbx: DbOrTx = defaultDb,
): Promise<MealPhotosResult> => {
  if (!isUuid(userId) || !isUuid(mealId)) return notFound;
  if (!photos.length) return { ok: false, status: 400, error: "Choose a photo to add." };
  if (!(await getMeal(userId, mealId, dbx))) return notFound;

  const processed = [];
  for (const photo of photos) processed.push(await processPhoto(photo));

  const now = new Date();
  const written: string[] = [];
  const rows: Omit<typeof mealPhotos.$inferInsert, "position">[] = [];
  try {
    for (const photo of processed) {
      const photoId = crypto.randomUUID();
      const paths = {} as Record<PhotoVariant, string>;
      for (const variant of ["original", "analysis", "thumb"] as const) {
        const relative = photoRelativePath(userId, photoId, variant, now);
        await writePhotoFile(relative, photo[variant]);
        written.push(relative);
        paths[variant] = relative;
      }
      rows.push({
        id: photoId,
        mealId,
        userId,
        originalPath: paths.original,
        analysisPath: paths.analysis,
        thumbPath: paths.thumb,
        width: photo.width,
        height: photo.height,
        bytes: photo.original.length,
        sha256: photo.sha256,
      });
    }

    const outcome = await dbx.transaction(async (tx) => {
      if (!(await lockMeal(tx, userId, mealId))) return notFound;
      const current = await photosOf(tx, mealId);
      if (current.length + rows.length > UPLOAD_LIMITS.maxPhotos)
        return {
          ok: false as const,
          status: 409 as const,
          error: `A meal holds at most ${UPLOAD_LIMITS.maxPhotos} photos. Remove one first.`,
        };
      // Close any gap first, so the new photos follow the last one.
      await writePositions(
        tx,
        mealId,
        current.map((p) => p.id),
      );
      await tx
        .insert(mealPhotos)
        .values(rows.map((row, i) => ({ ...row, position: current.length + i })));
      return null;
    });
    if (outcome) {
      await removePhotoFiles(written);
      return outcome;
    }
  } catch (error) {
    await removePhotoFiles(written).catch(() => undefined);
    throw error;
  }
  return finish(userId, mealId, !!options.reanalyse, dbx);
};

/**
 * Removes one photo; the others close up behind it (the next one becomes the cover when the cover
 * goes). Removing the last photo keeps the meal and its items.
 */
export const removeMealPhoto = async (
  userId: string,
  mealId: string,
  photoId: string,
  options: { reanalyse?: boolean } = {},
  dbx: DbOrTx = defaultDb,
): Promise<MealPhotosResult> => {
  if (!isUuid(userId) || !isUuid(mealId)) return notFound;
  if (!isUuid(photoId)) return { ok: false, status: 404, error: "Photo not found." };
  const removed = await dbx.transaction(async (tx) => {
    if (!(await lockMeal(tx, userId, mealId))) return notFound;
    const current = await photosOf(tx, mealId);
    const target = current.find((p) => p.id === photoId && p.userId === userId);
    if (!target) return { ok: false as const, status: 404 as const, error: "Photo not found." };
    await tx.delete(mealPhotos).where(eq(mealPhotos.id, photoId));
    await writePositions(
      tx,
      mealId,
      current.filter((p) => p.id !== photoId).map((p) => p.id),
    );
    return target;
  });
  if ("ok" in removed) return removed;
  // The row is gone; now its files.
  await removePhotoFiles([removed.originalPath, removed.analysisPath, removed.thumbPath]).catch(
    () => undefined,
  );
  return finish(userId, mealId, !!options.reanalyse, dbx);
};

/**
 * Puts the photos in a new order: `order` lists photo ids, the first becomes the cover; ids left
 * out keep their order after the listed ones. A single id just makes that photo the cover.
 */
export const reorderMealPhotos = async (
  userId: string,
  mealId: string,
  order: string[],
  options: { reanalyse?: boolean } = {},
  dbx: DbOrTx = defaultDb,
): Promise<MealPhotosResult> => {
  if (!isUuid(userId) || !isUuid(mealId)) return notFound;
  if (!order.length || !order.every(isUuid))
    return { ok: false, status: 400, error: "Say which photo comes first." };
  const outcome = await dbx.transaction(async (tx) => {
    if (!(await lockMeal(tx, userId, mealId))) return notFound;
    const current = await photosOf(tx, mealId);
    const known = new Set(current.map((p) => p.id));
    if (!order.every((id) => known.has(id)))
      return { ok: false as const, status: 404 as const, error: "Photo not found." };
    const listed = [...new Set(order)];
    const rest = current.map((p) => p.id).filter((id) => !listed.includes(id));
    await writePositions(tx, mealId, [...listed, ...rest]);
    return null;
  });
  if (outcome) return outcome;
  return finish(userId, mealId, !!options.reanalyse, dbx);
};
