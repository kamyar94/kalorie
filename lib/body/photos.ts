// Guided body photos (CONTRACT: lib/contracts/body-photos.ts). sharp intake as for meal photos but
// with the original kept at full size; files are written before the rows and removed after them.
// Only the person who took them reads them: no AI call, no admin view, no logging of contents.
import crypto from "node:crypto";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { bodyPhotos, bodyPhotoSessions } from "@/db/schema";
import {
  BODY_POSES,
  type BodyPhotoDto,
  type BodyPhotoSize,
  type BodyPhotoUpload,
  type BodySessionDto,
} from "@/lib/contracts/body-photos";
import { isUuid } from "@/lib/meals/service";
import { isValidTimeZone, localParts } from "@/lib/meals/time";
import { processBodyPhoto } from "@/lib/photos/intake";
import { bodyPhotoRelativePath, removePhotoFiles, writePhotoFile } from "@/lib/photos/storage";

type PhotoRow = typeof bodyPhotos.$inferSelect;
type SessionRow = typeof bodyPhotoSessions.$inferSelect;

export const bodyPhotoUrl = (id: string, size: BodyPhotoSize) => `/api/body-photos/${id}/${size}`;

const toPhotoDto = (row: PhotoRow): BodyPhotoDto => ({
  id: row.id,
  pose: row.pose,
  takenAt: row.takenAt.toISOString(),
  width: row.width,
  height: row.height,
  facing: row.facing,
  source: row.source,
  urls: {
    thumb: bodyPhotoUrl(row.id, "thumb"),
    view: bodyPhotoUrl(row.id, "view"),
    original: bodyPhotoUrl(row.id, "original"),
  },
});

const toSessionDto = (session: SessionRow, photos: PhotoRow[]): BodySessionDto => ({
  id: session.id,
  localDate: session.localDate,
  tz: session.tz,
  photos: photos
    .filter((p) => p.sessionId === session.id)
    .sort((a, b) => BODY_POSES.indexOf(a.pose) - BODY_POSES.indexOf(b.pose))
    .map(toPhotoDto),
});

const filesOf = (row: Pick<PhotoRow, "originalPath" | "viewPath" | "thumbPath">) => [
  row.originalPath,
  row.viewPath,
  row.thumbPath,
];

/**
 * Stores one pose of the day the photo was taken (in tz): the day's session is made when needed,
 * and a photo already there for the pose is replaced (its files removed). Throws PhotoError for an
 * unusable image.
 */
export const saveBodyPhoto = async (
  userId: string,
  upload: BodyPhotoUpload,
  dbx: DbOrTx = defaultDb,
): Promise<{ session: BodySessionDto; photo: BodyPhotoDto } | null> => {
  const takenAt = new Date(upload.takenAt);
  if (!isUuid(userId) || Number.isNaN(takenAt.getTime()) || !isValidTimeZone(upload.tz))
    return null;
  const processed = await processBodyPhoto(upload.photo);
  const id = crypto.randomUUID();
  const now = new Date();
  const paths = {
    originalPath: bodyPhotoRelativePath(userId, id, "original", now),
    viewPath: bodyPhotoRelativePath(userId, id, "view", now),
    thumbPath: bodyPhotoRelativePath(userId, id, "thumb", now),
  };
  await writePhotoFile(paths.originalPath, processed.original);
  await writePhotoFile(paths.viewPath, processed.view);
  await writePhotoFile(paths.thumbPath, processed.thumb);
  const localDate = localParts(takenAt, upload.tz).date;
  const { result, replaced } = await dbx
    .transaction(async (tx) => {
      const [session] = await tx
        .insert(bodyPhotoSessions)
        .values({ userId, localDate, tz: upload.tz })
        .onConflictDoUpdate({
          target: [bodyPhotoSessions.userId, bodyPhotoSessions.localDate],
          set: { updatedAt: now },
        })
        .returning();
      const replaced: PhotoRow | null =
        (
          await tx
            .delete(bodyPhotos)
            .where(and(eq(bodyPhotos.sessionId, session!.id), eq(bodyPhotos.pose, upload.pose)))
            .returning()
        )[0] ?? null;
      const [photo] = await tx
        .insert(bodyPhotos)
        .values({
          id,
          sessionId: session!.id,
          userId,
          pose: upload.pose,
          ...paths,
          width: processed.width,
          height: processed.height,
          bytes: processed.original.length,
          sha256: processed.sha256,
          takenAt,
          facing: upload.facing,
          source: upload.source,
        })
        .returning();
      const photos = await tx
        .select()
        .from(bodyPhotos)
        .where(eq(bodyPhotos.sessionId, session!.id));
      return {
        result: { session: toSessionDto(session!, photos), photo: toPhotoDto(photo!) },
        replaced,
      };
    })
    .catch(async (error: unknown) => {
      await removePhotoFiles(Object.values(paths)).catch(() => undefined);
      throw error;
    });
  if (replaced) await removePhotoFiles(filesOf(replaced)).catch(() => undefined);
  return result;
};

/** The person's sessions, newest first, each with its photos (front, left, back, right). */
export const listBodySessions = async (
  userId: string,
  dbx: DbOrTx = defaultDb,
): Promise<BodySessionDto[]> => {
  if (!isUuid(userId)) return [];
  const sessions = await dbx
    .select()
    .from(bodyPhotoSessions)
    .where(eq(bodyPhotoSessions.userId, userId))
    .orderBy(desc(bodyPhotoSessions.localDate));
  if (!sessions.length) return [];
  const photos = await dbx
    .select()
    .from(bodyPhotos)
    .where(
      and(
        eq(bodyPhotos.userId, userId),
        inArray(
          bodyPhotos.sessionId,
          sessions.map((s) => s.id),
        ),
      ),
    )
    .orderBy(asc(bodyPhotos.takenAt));
  return sessions.map((s) => toSessionDto(s, photos));
};

/** Removes one photo (and its day's session when it was the last one). */
export const deleteBodyPhoto = async (
  userId: string,
  photoId: string,
  dbx: DbOrTx = defaultDb,
): Promise<boolean> => {
  if (!isUuid(userId) || !isUuid(photoId)) return false;
  const removed = await dbx.transaction(async (tx) => {
    const [row] = await tx
      .delete(bodyPhotos)
      .where(and(eq(bodyPhotos.id, photoId), eq(bodyPhotos.userId, userId)))
      .returning();
    if (!row) return null;
    const left = await tx
      .select({ id: bodyPhotos.id })
      .from(bodyPhotos)
      .where(eq(bodyPhotos.sessionId, row.sessionId))
      .limit(1);
    if (!left.length)
      await tx.delete(bodyPhotoSessions).where(eq(bodyPhotoSessions.id, row.sessionId));
    return row;
  });
  if (!removed) return false;
  await removePhotoFiles(filesOf(removed)).catch(() => undefined);
  return true;
};

const COLUMNS = {
  thumb: bodyPhotos.thumbPath,
  view: bodyPhotos.viewPath,
  original: bodyPhotos.originalPath,
} as const;

/** The stored path of one size of the person's own photo, or null. */
export const bodyPhotoPath = async (
  userId: string,
  photoId: string,
  size: BodyPhotoSize,
  dbx: DbOrTx = defaultDb,
) => {
  if (!isUuid(userId) || !isUuid(photoId) || !(size in COLUMNS)) return null;
  const row = (
    await dbx
      .select({ path: COLUMNS[size] })
      .from(bodyPhotos)
      .where(and(eq(bodyPhotos.id, photoId), eq(bodyPhotos.userId, userId)))
      .limit(1)
  )[0];
  return row?.path ?? null;
};

/** Every file of the person's body photos ("Delete my data"). */
export const bodyPhotoFiles = async (userId: string, dbx: DbOrTx = defaultDb) =>
  (
    await dbx
      .select({
        originalPath: bodyPhotos.originalPath,
        viewPath: bodyPhotos.viewPath,
        thumbPath: bodyPhotos.thumbPath,
      })
      .from(bodyPhotos)
      .where(eq(bodyPhotos.userId, userId))
  ).flatMap(filesOf);
