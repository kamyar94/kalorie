// Photos of a medicine's box or blister (Medicine mode of the camera). The photo is re-encoded like
// a meal photo (lib/photos/intake.ts) and stored under PHOTO_ROOT; then the job
// "read-medicine-label" asks the person's AI provider to read it (lib/medicines/label.ts). Without
// any AI key the scan fails at once ("no-key"), so the screen offers the empty sheet without a
// wait. A label photo that never became part of a log is removed after a day. Owner only.
// "Log as a medicine" (lib/medicines/from-meal.ts) stores a copy of a meal's cover photo the same
// way.
import crypto from "node:crypto";

import { and, eq, lt, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { aiKeys, medicineLogs, medicineScans } from "@/db/schema";
import {
  READ_MEDICINE_LABEL_JOB,
  type MedicineScanDto,
  type ReadMedicineLabelPayload,
} from "@/lib/contracts/medicines";
import { isUuid } from "@/lib/meals/service";
import { processPhoto, type PhotoVariant, type ProcessedPhoto } from "@/lib/photos/intake";
import { photoRelativePath, removePhotoFiles, writePhotoFile } from "@/lib/photos/storage";
import { enqueueJob } from "@/lib/queue/queue";

import { LABEL_MAX_ATTEMPTS, labelError, labelErrorNeedsSettings } from "./label";
import { scanPhotoUrl } from "./service";

/** Label photos not used by any log are removed after this long. */
export const UNUSED_SCAN_MS = 24 * 3_600_000;

type ScanRow = typeof medicineScans.$inferSelect;

export const toScanDto = (row: ScanRow): MedicineScanDto => ({
  id: row.id,
  status: row.status,
  reading: row.reading ?? null,
  error: row.error
    ? {
        kind: row.error.kind,
        message: row.error.message,
        settingsLink: labelErrorNeedsSettings(row.error.kind),
      }
    : null,
  photo: { thumb: scanPhotoUrl(row.id, "thumb"), original: scanPhotoUrl(row.id, "original") },
});

/** Removes the person's label photos older than a day that no log uses (rows, then files). */
export const pruneUnusedScans = async (userId: string, dbx: DbOrTx = defaultDb) => {
  const gone = await dbx
    .delete(medicineScans)
    .where(
      and(
        eq(medicineScans.userId, userId),
        lt(medicineScans.createdAt, new Date(Date.now() - UNUSED_SCAN_MS)),
        sql`not exists (select 1 from ${medicineLogs} l where l.scan_id = ${medicineScans.id})`,
      ),
    )
    .returning();
  await removePhotoFiles(gone.flatMap((s) => [s.originalPath, s.analysisPath, s.thumbPath])).catch(
    () => undefined,
  );
  return gone.length;
};

/**
 * Stores a label photo and queues its reading. Throws PhotoError for a photo that cannot be read.
 */
export const createMedicineScan = async (
  userId: string,
  photo: Buffer,
  dbx: DbOrTx = defaultDb,
): Promise<MedicineScanDto> => {
  if (!isUuid(userId)) throw new Error("Unknown account.");
  await pruneUnusedScans(userId, dbx).catch(() => undefined);
  return storeMedicineScan(userId, await processPhoto(photo), {}, dbx);
};

/**
 * Stores the files of a label photo that is already re-encoded (a new photo, or a copy of a meal's
 * photo for "Log as a medicine") as the person's own and queues its reading. With mealId the job
 * reads that meal's photos (all of them, while the meal is there), else the scan's own photo.
 */
export const storeMedicineScan = async (
  userId: string,
  processed: ProcessedPhoto,
  options: { mealId?: string } = {},
  dbx: DbOrTx = defaultDb,
): Promise<MedicineScanDto> => {
  const id = crypto.randomUUID();
  const now = new Date();
  const paths = {} as Record<PhotoVariant, string>;
  const written: string[] = [];
  try {
    for (const variant of ["original", "analysis", "thumb"] as const) {
      const relative = photoRelativePath(userId, id, variant, now);
      await writePhotoFile(relative, processed[variant]);
      written.push(relative);
      paths[variant] = relative;
    }
    const hasKey =
      (await dbx.select({ id: aiKeys.id }).from(aiKeys).where(eq(aiKeys.userId, userId)).limit(1))
        .length > 0;
    const row = await dbx.transaction(async (tx) => {
      const [scan] = await tx
        .insert(medicineScans)
        .values({
          id,
          userId,
          status: hasKey ? "queued" : "failed",
          error: hasKey ? null : labelError("no-key"),
          originalPath: paths.original,
          analysisPath: paths.analysis,
          thumbPath: paths.thumb,
          width: processed.width,
          height: processed.height,
          bytes: processed.original.length,
          sha256: processed.sha256,
        })
        .returning();
      if (hasKey)
        await enqueueJob(
          READ_MEDICINE_LABEL_JOB,
          {
            scanId: id,
            userId,
            ...(options.mealId ? { mealId: options.mealId } : {}),
          } satisfies ReadMedicineLabelPayload,
          { userId, maxAttempts: LABEL_MAX_ATTEMPTS },
          tx,
        );
      return scan!;
    });
    return toScanDto(row);
  } catch (error) {
    await removePhotoFiles(written).catch(() => undefined);
    throw error;
  }
};

/** The scan and its reading, or null when it is not the person's. */
export const getMedicineScan = async (
  userId: string,
  scanId: string,
  dbx: DbOrTx = defaultDb,
): Promise<MedicineScanDto | null> => {
  if (!isUuid(userId) || !isUuid(scanId)) return null;
  const row = (
    await dbx
      .select()
      .from(medicineScans)
      .where(and(eq(medicineScans.id, scanId), eq(medicineScans.userId, userId)))
      .limit(1)
  )[0];
  return row ? toScanDto(row) : null;
};

/** The stored path of a scan's photo for its owner, or null. */
export const scanPhotoPath = async (
  userId: string,
  scanId: string,
  size: "thumb" | "original",
  dbx: DbOrTx = defaultDb,
) => {
  if (!isUuid(userId) || !isUuid(scanId)) return null;
  const row = (
    await dbx
      .select({ thumb: medicineScans.thumbPath, original: medicineScans.originalPath })
      .from(medicineScans)
      .where(and(eq(medicineScans.id, scanId), eq(medicineScans.userId, userId)))
      .limit(1)
  )[0];
  return row ? row[size] : null;
};
