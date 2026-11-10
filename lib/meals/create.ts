// Creating a meal from uploaded photos (POST /api/meals). The photos are decoded and re-encoded
// with sharp and written under PHOTO_ROOT first; then the meal, its photo rows and the analysis
// job are inserted in one transaction, so the worker never sees a meal without its photos. If the
// transaction fails, the written files are removed again. A meal without photos is a text meal
// (source "text"): the analysis reads its note instead.
import crypto from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { mealItems, mealPhotos, meals, users } from "@/db/schema";
import { ANALYZE_MEAL_JOB, type AnalyzeMealPayload } from "@/lib/contracts/analysis";
import type { MealSummaryDto } from "@/lib/contracts/meals";
import { processPhoto, type PhotoVariant } from "@/lib/photos/intake";
import { photoRelativePath, removePhotoFiles, writePhotoFile } from "@/lib/photos/storage";
import { enqueueJob } from "@/lib/queue/queue";

import { toSummaryDto } from "./dto";
import { localParts, slotFor, type MealWindows } from "./time";

export type NewPhotoMeal = {
  userId: string;
  /** The device's id for the meal, for safe retries. */
  clientId: string | null;
  eatenAt: Date;
  tz: string;
  note: string | null;
  /** None for a text-only meal (then note is required). */
  photos: Buffer[];
};

/** Enqueues the analysis of a meal (deduplicated per meal while a job is waiting). */
export const enqueueMealAnalysis = async (payload: AnalyzeMealPayload, dbx: DbOrTx = defaultDb) =>
  enqueueJob(
    ANALYZE_MEAL_JOB,
    payload,
    {
      userId: payload.userId,
      maxAttempts: 4,
      dedupeKey: payload.replaceEdits ? undefined : `meal:${payload.mealId}`,
    },
    dbx,
  );

const existingByClientId = async (userId: string, clientId: string, dbx: DbOrTx) => {
  const row = (
    await dbx
      .select()
      .from(meals)
      .where(and(eq(meals.userId, userId), eq(meals.clientId, clientId), isNull(meals.deletedAt)))
      .limit(1)
  )[0];
  if (!row) return null;
  const photos = await dbx.select().from(mealPhotos).where(eq(mealPhotos.mealId, row.id));
  const items = await dbx
    .select({
      position: mealItems.position,
      name: mealItems.name,
      localName: mealItems.localName,
      kind: mealItems.kind,
      emoji: mealItems.emoji,
      foodName: sql<string | null>`null`,
    })
    .from(mealItems)
    .where(eq(mealItems.mealId, row.id));
  return toSummaryDto(row, photos, items);
};

/**
 * Stores the photos and the meal and queues its analysis. Returns the existing meal with
 * duplicate true when the same clientId was uploaded before. Throws PhotoError for photos that
 * cannot be read, and an Error for a meal with neither photos nor a note.
 */
export const createPhotoMeal = async (
  input: NewPhotoMeal,
  dbx: DbOrTx = defaultDb,
): Promise<{ meal: MealSummaryDto; duplicate: boolean }> => {
  if (input.clientId) {
    const existing = await existingByClientId(input.userId, input.clientId, dbx);
    if (existing) return { meal: existing, duplicate: true };
  }

  if (!input.photos.length && !input.note?.trim())
    throw new Error("A meal needs a photo or a description.");
  const processed = [];
  for (const photo of input.photos) processed.push(await processPhoto(photo));

  const mealId = crypto.randomUUID();
  const now = new Date();
  const written: string[] = [];
  const photoRows: (typeof mealPhotos.$inferInsert)[] = [];
  try {
    for (const [position, photo] of processed.entries()) {
      const photoId = crypto.randomUUID();
      const paths = {} as Record<PhotoVariant, string>;
      for (const variant of ["original", "analysis", "thumb"] as const) {
        const relative = photoRelativePath(input.userId, photoId, variant, now);
        await writePhotoFile(relative, photo[variant]);
        written.push(relative);
        paths[variant] = relative;
      }
      photoRows.push({
        id: photoId,
        mealId,
        userId: input.userId,
        position,
        originalPath: paths.original,
        analysisPath: paths.analysis,
        thumbPath: paths.thumb,
        width: photo.width,
        height: photo.height,
        bytes: photo.original.length,
        sha256: photo.sha256,
      });
    }

    const windows = (
      await dbx
        .select({ w: users.mealWindows })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1)
    )[0]?.w as MealWindows | undefined;

    const result = await dbx.transaction(async (tx) => {
      const [meal] = await tx
        .insert(meals)
        .values({
          id: mealId,
          userId: input.userId,
          clientId: input.clientId,
          eatenAt: input.eatenAt,
          tz: input.tz,
          localDate: localParts(input.eatenAt, input.tz).date,
          slot: slotFor(input.eatenAt, input.tz, windows),
          note: input.note,
          status: "queued",
          source: photoRows.length ? "photo" : "text",
        })
        .onConflictDoNothing()
        .returning();
      if (!meal) return null;
      const inserted = photoRows.length
        ? await tx.insert(mealPhotos).values(photoRows).returning()
        : [];
      await enqueueMealAnalysis({ mealId, userId: input.userId, reason: "upload" }, tx);
      return toSummaryDto(meal, inserted, []);
    });

    if (!result) {
      // The same clientId arrived twice at the same moment; the other request won.
      await removePhotoFiles(written);
      const existing = input.clientId
        ? await existingByClientId(input.userId, input.clientId, dbx)
        : null;
      if (!existing) throw new Error("The meal could not be saved.");
      return { meal: existing, duplicate: true };
    }
    return { meal: result, duplicate: false };
  } catch (error) {
    await removePhotoFiles(written).catch(() => undefined);
    throw error;
  }
};
