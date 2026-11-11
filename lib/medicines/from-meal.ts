// "Log as a medicine": a meal whose analysis found a medicine or a supplement instead of food
// (lib/analysis/not-food.ts) becomes a medicine log, as if it had been taken in the camera's
// Medicine mode.
//
// The label is read from the meal's own photos: a copy of the cover photo is stored as the
// person's label photo (a medicine scan, lib/medicines/scans.ts) and the job reads all the meal's
// photos while the meal is there. Saving logs the medicine with that label photo (kept with the log,
// as a scan from the camera is) and removes the meal in the same transaction: the meal row with its
// photo and item rows, then the meal's photo files. A label photo that is never saved is removed
// after a day, like any unused scan. A second request with the same label photo (a double tap)
// answers with the log the first one made. Owner only: someone else's meal is "not found".
import { and, asc, eq, isNull } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { mealPhotos, meals, medicineLogs, medicines } from "@/db/schema";
import { isMedicineKind, mealNotFoodKind } from "@/lib/analysis/not-food";
import type { LoggedMedicine, MedicineScanDto, NewMedicineLog } from "@/lib/contracts/medicines";
import { isUuid } from "@/lib/meals/service";
import { isValidTimeZone } from "@/lib/meals/time";
import { readPhotoFile, removePhotoFiles } from "@/lib/photos/storage";

import { pruneUnusedScans, storeMedicineScan } from "./scans";
import { logMedicine, toLogDto, toMedicineDto } from "./service";

type MealRow = typeof meals.$inferSelect;

export type FromMealResult<T> =
  | { ok: true; status: 200 | 201 | 202; value: T }
  | { ok: false; status: 404 | 409 | 422; error: string };

const notFound = { ok: false as const, status: 404 as const, error: "Meal not found." };
const notMedicine = {
  ok: false as const,
  status: 409 as const,
  error: "Only a meal Kal found to be a medicine or a supplement can be logged as a medicine.",
};

/** Whether a meal can be logged as a medicine: failed as not food, and a medicine or supplement. */
export const mealIsMedicine = (row: MealRow, photoCount: number) =>
  row.status === "failed" &&
  isMedicineKind(
    mealNotFoodKind({
      error: row.error,
      analysis: row.analysis,
      note: row.note,
      textOnly: row.source === "text" && photoCount === 0,
    }),
  );

const ownMeal = (userId: string, mealId: string) =>
  and(eq(meals.id, mealId), eq(meals.userId, userId), isNull(meals.deletedAt));

const photosOf = (dbx: DbOrTx, mealId: string) =>
  dbx
    .select()
    .from(mealPhotos)
    .where(eq(mealPhotos.mealId, mealId))
    .orderBy(asc(mealPhotos.position), asc(mealPhotos.createdAt));

/**
 * Starts reading the label from the meal's photos: stores a copy of the cover as the person's
 * label photo and queues the reading (or answers "failed", no-key, at once without an AI key).
 */
export const mealMedicineScan = async (
  userId: string,
  mealId: string,
  dbx: DbOrTx = defaultDb,
): Promise<FromMealResult<MedicineScanDto>> => {
  if (!isUuid(userId) || !isUuid(mealId)) return notFound;
  const row = (await dbx.select().from(meals).where(ownMeal(userId, mealId)).limit(1))[0];
  if (!row) return notFound;
  const photos = await photosOf(dbx, mealId);
  if (!mealIsMedicine(row, photos.length)) return notMedicine;
  const cover = photos[0];
  if (!cover)
    return {
      ok: false,
      status: 409,
      error: "This meal has no photo to read. Type the medicine instead.",
    };
  const [original, analysis, thumb] = await Promise.all(
    [cover.originalPath, cover.analysisPath, cover.thumbPath].map(readPhotoFile),
  );
  if (!original?.length || !analysis?.length || !thumb?.length)
    return {
      ok: false,
      status: 422,
      error: "The photos of this meal could not be read. Type the medicine instead.",
    };
  await pruneUnusedScans(userId, dbx).catch(() => undefined);
  const scan = await storeMedicineScan(
    userId,
    { original, analysis, thumb, width: cover.width, height: cover.height, sha256: cover.sha256 },
    { mealId },
    dbx,
  );
  return { ok: true, status: 202, value: scan };
};

/** The log already made with this label photo (the first of a double tap), or null. */
const loggedWith = async (
  dbx: DbOrTx,
  userId: string,
  scanId: string,
): Promise<LoggedMedicine | null> => {
  const log = (
    await dbx
      .select()
      .from(medicineLogs)
      .where(and(eq(medicineLogs.scanId, scanId), eq(medicineLogs.userId, userId)))
      .orderBy(asc(medicineLogs.createdAt))
      .limit(1)
  )[0];
  if (!log) return null;
  const medicine = log.medicineId
    ? ((
        await dbx
          .select()
          .from(medicines)
          .where(and(eq(medicines.id, log.medicineId), eq(medicines.userId, userId)))
          .limit(1)
      )[0] ?? null)
    : null;
  return { log: toLogDto(log), medicine: medicine ? toMedicineDto(medicine, log.takenAt) : null };
};

/**
 * Logs the medicine the meal shows and removes the meal (rows in one transaction, then its photo
 * files). The time zone of the log is the meal's unless a valid one is given.
 */
export const logMealAsMedicine = async (
  userId: string,
  mealId: string,
  input: NewMedicineLog,
  dbx: DbOrTx = defaultDb,
): Promise<FromMealResult<LoggedMedicine>> => {
  if (!isUuid(userId) || !isUuid(mealId)) return notFound;
  const outcome = await dbx.transaction(
    async (
      tx,
    ): Promise<
      | { ok: true; status: 200 | 201; value: LoggedMedicine; files: string[] }
      | { ok: false; status: 404 | 409; error: string }
    > => {
      // Locked, so a second request for the same meal waits for the first one to finish.
      const row = (
        await tx.select().from(meals).where(ownMeal(userId, mealId)).for("update").limit(1)
      )[0];
      if (!row) {
        // The first tap went through: the meal is gone and its label photo is logged.
        const again = input.scanId ? await loggedWith(tx, userId, input.scanId) : null;
        return again ? { ok: true, status: 200, value: again, files: [] } : notFound;
      }
      const photos = await photosOf(tx, mealId);
      if (!mealIsMedicine(row, photos.length)) return notMedicine;
      const logged = await logMedicine(
        userId,
        { ...input, tz: isValidTimeZone(input.tz) ? input.tz : row.tz },
        tx,
      );
      if (!logged)
        return { ok: false, status: 404, error: "The medicine or its label photo was not found." };
      // The meal's photo and item rows go with it (ON DELETE CASCADE); the files after the commit.
      await tx.delete(meals).where(eq(meals.id, mealId));
      return {
        ok: true,
        status: 201,
        value: logged,
        files: photos.flatMap((p) => [p.originalPath, p.analysisPath, p.thumbPath]),
      };
    },
  );
  if (!outcome.ok) return outcome;
  await removePhotoFiles(outcome.files).catch(() => undefined);
  return { ok: true, status: outcome.status, value: outcome.value };
};
