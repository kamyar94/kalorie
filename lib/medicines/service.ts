// The person's medicines and what they took (CONTRACT: lib/contracts/medicines.ts). Every function
// takes the signed-in person's id and touches only their rows; someone else's id behaves like one
// that does not exist. Medicine data is never written to the logs.
import { and, asc, desc, eq, gte, inArray, max, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { medicineLogs, medicines, medicineScans } from "@/db/schema";
import {
  MEDICINE_LIMITS,
  unitFor,
  type LoggedMedicine,
  type MedicineDayDto,
  type MedicineDto,
  type MedicineHistoryDay,
  type MedicineInput,
  type MedicineLogDto,
  type MedicinePatch,
  type NewMedicineLog,
} from "@/lib/contracts/medicines";
import { isUuid } from "@/lib/meals/service";
import { isLocalDate, isValidTimeZone, localParts, shiftLocalDate } from "@/lib/meals/time";
import { removePhotoFiles } from "@/lib/photos/storage";

type MedicineRow = typeof medicines.$inferSelect;
type LogRow = typeof medicineLogs.$inferSelect;

export const scanPhotoUrl = (scanId: string, size: "thumb" | "original") =>
  `/api/medicine-scans/${scanId}/${size}`;

export const toMedicineDto = (row: MedicineRow, lastTakenAt: Date | null = null): MedicineDto => ({
  id: row.id,
  name: row.name,
  strength: row.strength,
  form: row.form,
  usualAmount: row.usualAmount,
  unit: row.unit,
  ingredients: row.ingredients ?? [],
  notes: row.notes,
  archived: row.archived,
  lastTakenAt: lastTakenAt ? new Date(lastTakenAt).toISOString() : null,
});

export const toLogDto = (row: LogRow): MedicineLogDto => ({
  id: row.id,
  medicineId: row.medicineId,
  name: row.name,
  strength: row.strength,
  form: row.form,
  amount: row.amount,
  unit: row.unit,
  takenAt: row.takenAt.toISOString(),
  tz: row.tz,
  localDate: row.localDate,
  localTime: localParts(row.takenAt, row.tz).time,
  photo: row.scanId
    ? { thumb: scanPhotoUrl(row.scanId, "thumb"), original: scanPhotoUrl(row.scanId, "original") }
    : null,
});

const lastTaken = async (userId: string, ids: string[], dbx: DbOrTx) => {
  if (!ids.length) return new Map<string, Date>();
  const rows = await dbx
    .select({ id: medicineLogs.medicineId, at: max(medicineLogs.takenAt) })
    .from(medicineLogs)
    .where(and(eq(medicineLogs.userId, userId), inArray(medicineLogs.medicineId, ids)))
    .groupBy(medicineLogs.medicineId);
  return new Map(rows.flatMap((r) => (r.id && r.at ? [[r.id, r.at] as const] : [])));
};

/** The person's medicines: in use first, then archived; by name. */
export const listMedicines = async (
  userId: string,
  dbx: DbOrTx = defaultDb,
): Promise<MedicineDto[]> => {
  if (!isUuid(userId)) return [];
  const rows = await dbx
    .select()
    .from(medicines)
    .where(eq(medicines.userId, userId))
    .orderBy(asc(medicines.archived), asc(sql`lower(${medicines.name})`), asc(medicines.createdAt));
  const last = await lastTaken(
    userId,
    rows.map((r) => r.id),
    dbx,
  );
  return rows.map((row) => toMedicineDto(row, last.get(row.id) ?? null));
};

const ownMedicine = (userId: string, id: string) =>
  and(eq(medicines.id, id), eq(medicines.userId, userId));

/** Adds a medicine to the list. The name is required. */
export const createMedicine = async (
  userId: string,
  input: MedicineInput,
  dbx: DbOrTx = defaultDb,
): Promise<MedicineDto | null> => {
  const name = input.name.trim().slice(0, MEDICINE_LIMITS.nameChars);
  if (!isUuid(userId) || !name) return null;
  const amount = input.usualAmount ?? 1;
  const [row] = await dbx
    .insert(medicines)
    .values({
      userId,
      name,
      strength: input.strength ?? null,
      form: input.form ?? null,
      usualAmount: amount,
      unit: input.unit ?? unitFor(input.form ?? null, 1),
      ingredients: input.ingredients ?? [],
      notes: input.notes ?? null,
    })
    .returning();
  return toMedicineDto(row!);
};

/** Changes a medicine of the list (also archives or restores it). */
export const updateMedicine = async (
  userId: string,
  id: string,
  patch: MedicinePatch,
  dbx: DbOrTx = defaultDb,
): Promise<MedicineDto | null> => {
  if (!isUuid(userId) || !isUuid(id)) return null;
  const set: Partial<typeof medicines.$inferInsert> = {};
  if (patch.name) set.name = patch.name.slice(0, MEDICINE_LIMITS.nameChars);
  if (patch.strength !== undefined) set.strength = patch.strength;
  if (patch.form !== undefined) {
    set.form = patch.form;
    // A new form brings its unit unless one is given.
    if (patch.unit === undefined) set.unit = unitFor(patch.form, 1);
  }
  if (patch.usualAmount !== undefined) set.usualAmount = patch.usualAmount;
  if (patch.unit !== undefined) set.unit = patch.unit;
  if (patch.ingredients !== undefined) set.ingredients = patch.ingredients;
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (patch.archived !== undefined) set.archived = patch.archived;
  const [row] = Object.keys(set).length
    ? await dbx.update(medicines).set(set).where(ownMedicine(userId, id)).returning()
    : await dbx.select().from(medicines).where(ownMedicine(userId, id)).limit(1);
  if (!row) return null;
  const last = await lastTaken(userId, [row.id], dbx);
  return toMedicineDto(row, last.get(row.id) ?? null);
};

/** The person's medicine with this name and strength (any case), archived ones too. */
const findSame = async (
  userId: string,
  name: string,
  strength: string | null,
  dbx: DbOrTx,
): Promise<MedicineRow | null> =>
  (
    await dbx
      .select()
      .from(medicines)
      .where(
        and(
          eq(medicines.userId, userId),
          sql`lower(${medicines.name}) = lower(${name})`,
          sql`lower(coalesce(${medicines.strength}, '')) = lower(${strength ?? ""})`,
        ),
      )
      .orderBy(asc(medicines.archived), asc(medicines.createdAt))
      .limit(1)
  )[0] ?? null;

/**
 * Logs a medicine taken. From the list: what is not given comes from the medicine (the usual
 * amount for "Log now"). Typed or read from a label: keep adds it to the list (or finds the same
 * one there, and brings it back from the archive). Null when the medicine, the label photo or the
 * time zone is not valid for this person.
 */
export const logMedicine = async (
  userId: string,
  input: NewMedicineLog,
  dbx: DbOrTx = defaultDb,
): Promise<LoggedMedicine | null> => {
  if (!isUuid(userId)) return null;
  const takenAt = new Date(input.takenAt);
  if (Number.isNaN(takenAt.getTime()) || !isValidTimeZone(input.tz)) return null;
  return dbx.transaction(async (tx) => {
    let medicine: MedicineRow | null = null;
    if (input.medicineId) {
      medicine =
        (
          await tx.select().from(medicines).where(ownMedicine(userId, input.medicineId)).limit(1)
        )[0] ?? null;
      if (!medicine) return null;
    }
    if (input.scanId) {
      const scan = await tx
        .select({ id: medicineScans.id })
        .from(medicineScans)
        .where(and(eq(medicineScans.id, input.scanId), eq(medicineScans.userId, userId)))
        .limit(1);
      if (!scan.length) return null;
    }
    const name = input.name ?? medicine?.name;
    if (!name) return null;
    const strength = input.strength !== undefined ? input.strength : (medicine?.strength ?? null);
    const form = input.form !== undefined ? input.form : (medicine?.form ?? null);
    const amount = input.amount ?? medicine?.usualAmount ?? 1;
    const unit =
      input.unit !== undefined ? input.unit : (medicine?.unit ?? unitFor(form, 1) ?? null);

    if (!medicine && input.keep) {
      const same = await findSame(userId, name, strength, tx);
      const [kept] = same
        ? same.archived
          ? await tx
              .update(medicines)
              .set({ archived: false })
              .where(eq(medicines.id, same.id))
              .returning()
          : [same]
        : await tx
            .insert(medicines)
            .values({
              userId,
              name,
              strength,
              form,
              usualAmount: amount,
              unit,
              ingredients: input.ingredients ?? [],
            })
            .returning();
      medicine = kept ?? null;
    }

    const [row] = await tx
      .insert(medicineLogs)
      .values({
        userId,
        medicineId: medicine?.id ?? null,
        name,
        strength,
        form,
        amount,
        unit,
        takenAt,
        tz: input.tz,
        localDate: localParts(takenAt, input.tz).date,
        scanId: input.scanId ?? null,
      })
      .returning();
    return {
      log: toLogDto(row!),
      medicine: medicine ? toMedicineDto(medicine, takenAt) : null,
    };
  });
};

/**
 * Removes a log. Its label photo goes too when no other log uses it (the row first, then the
 * files).
 */
export const deleteMedicineLog = async (
  userId: string,
  logId: string,
  dbx: DbOrTx = defaultDb,
): Promise<boolean> => {
  if (!isUuid(userId) || !isUuid(logId)) return false;
  const files = await dbx.transaction(async (tx) => {
    const [gone] = await tx
      .delete(medicineLogs)
      .where(and(eq(medicineLogs.id, logId), eq(medicineLogs.userId, userId)))
      .returning();
    if (!gone) return null;
    if (!gone.scanId) return [];
    const others = await tx
      .select({ id: medicineLogs.id })
      .from(medicineLogs)
      .where(eq(medicineLogs.scanId, gone.scanId))
      .limit(1);
    if (others.length) return [];
    const [scan] = await tx
      .delete(medicineScans)
      .where(and(eq(medicineScans.id, gone.scanId), eq(medicineScans.userId, userId)))
      .returning();
    return scan ? [scan.originalPath, scan.analysisPath, scan.thumbPath] : [];
  });
  if (files === null) return false;
  await removePhotoFiles(files).catch(() => undefined);
  return true;
};

const logsBetween = async (userId: string, from: string, to: string, dbx: DbOrTx) =>
  dbx
    .select()
    .from(medicineLogs)
    .where(
      and(
        eq(medicineLogs.userId, userId),
        gte(medicineLogs.localDate, from),
        sql`${medicineLogs.localDate} <= ${to}`,
      ),
    )
    .orderBy(desc(medicineLogs.localDate), asc(medicineLogs.takenAt));

/**
 * Today's Medicines card for one local day: that day's logs (oldest first) and the medicines in use
 * not logged that day yet.
 */
export const medicineDay = async (
  userId: string,
  localDate: string,
  dbx: DbOrTx = defaultDb,
): Promise<MedicineDayDto> => {
  if (!isUuid(userId) || !isLocalDate(localDate)) return { logs: [], due: [] };
  const [logs, list] = await Promise.all([
    logsBetween(userId, localDate, localDate, dbx),
    listMedicines(userId, dbx),
  ]);
  const taken = new Set(logs.map((l) => l.medicineId).filter(Boolean));
  return {
    logs: logs.map(toLogDto),
    due: list.filter((m) => !m.archived && !taken.has(m.id)),
  };
};

/** The logs of the last `days` days up to `today`, by day, newest day first. */
export const medicineHistory = async (
  userId: string,
  today: string,
  days = 90,
  dbx: DbOrTx = defaultDb,
): Promise<MedicineHistoryDay[]> => {
  if (!isUuid(userId) || !isLocalDate(today)) return [];
  const rows = await logsBetween(userId, shiftLocalDate(today, -(days - 1)), today, dbx);
  const out: MedicineHistoryDay[] = [];
  for (const row of rows) {
    const last = out.at(-1);
    if (last?.localDate === row.localDate) last.logs.push(toLogDto(row));
    else out.push({ localDate: row.localDate, logs: [toLogDto(row)] });
  }
  return out;
};
