// "Export my data" and "Delete my data" (Settings). The export holds everything Kal keeps about
// the person except secrets (no keys, no password hash, no integration tokens) and the photo
// files themselves. Deleting removes every logged meal, photo file, item, personal food,
// correction memory, medicine, medicine log and label photo, activity, badge, body measurement,
// body photo (and its files), the health profile, key, integration, notification subscription
// and custom target, and resets the profile; the account itself (name, username, password, role)
// stays so the person can go on.
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import {
  activities,
  aiKeys,
  bodyMeasurements,
  bodyPhotoSessions,
  aiSettings,
  aiUsage,
  dishComponents,
  foodMemory,
  foods,
  healthProfiles,
  integrations,
  jobs,
  mealItems,
  mealPhotos,
  meals,
  medicineLogs,
  medicines,
  medicineScans,
  pushSubscriptions,
  userBadges,
  users,
  userTargets,
} from "@/db/schema";
import { toActivityDto } from "@/lib/activities/service";
import { bodyPhotoFiles, listBodySessions } from "@/lib/body/photos";
import { toMeasurementDto } from "@/lib/body/service";
import { audit } from "@/lib/audit";
import type { ActivityDto } from "@/lib/contracts/activities";
import type { MeasurementDto } from "@/lib/contracts/body";
import type { BodySessionDto } from "@/lib/contracts/body-photos";
import type { MealDto } from "@/lib/contracts/meals";
import type { MedicineDto, MedicineLogDto } from "@/lib/contracts/medicines";
import { NUTRIENT_CATALOGUE } from "@/lib/contracts/nutrients";
import { toMealDto } from "@/lib/meals/dto";
import { DEFAULT_MEAL_WINDOWS } from "@/lib/meals/time";
import { toLogDto, toMedicineDto } from "@/lib/medicines/service";
import { removePhotoFiles } from "@/lib/photos/storage";

export type ExportData = {
  format: "cal-export";
  version: 1;
  exportedAt: string;
  account: {
    username: string;
    displayName: string;
    createdAt: string;
    profile: Record<string, unknown>;
    preferences: Record<string, unknown>;
  };
  targets: { code: string; target: number | null; upper: number | null; kind: string }[];
  meals: MealDto[];
  personalFoods: {
    id: string;
    nameEn: string;
    nameFa: string | null;
    brand: string | null;
    barcode: string | null;
    servingGrams: number | null;
    per100g: Record<string, number>;
  }[];
  memory: { name: string; foodId: string | null; typicalGrams: number | null; count: number }[];
  /** The person's medicines (archived too) and every medicine taken, oldest first. */
  medicines: MedicineDto[];
  medicineLogs: MedicineLogDto[];
  /** Workouts, typed activities, imported sessions and steps per day, oldest first. */
  activities: ActivityDto[];
  /** Move's badges and the day each was earned. */
  badges: { code: string; earnedOn: string }[];
  /** Weight, body composition and tape measurements from every source, oldest first. */
  bodyMeasurements: MeasurementDto[];
  /** The private health profile (height, birth year and goal are in account.profile). */
  healthProfile: { conditions: string; allergies: string; notes: string; useInAnalysis: boolean };
  /** Body photo sessions by day, each pose with its time (the files themselves are not in it). */
  bodyPhotos: BodySessionDto[];
};

/** Everything about the person as JSON-ready data. Null for an unknown account. */
export const exportUserData = async (
  userId: string,
  dbx: DbOrTx = defaultDb,
): Promise<ExportData | null> => {
  const user = (await dbx.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!user) return null;
  const mealRows = await dbx
    .select()
    .from(meals)
    .where(and(eq(meals.userId, userId), isNull(meals.deletedAt)))
    .orderBy(asc(meals.eatenAt));
  const ids = mealRows.map((m) => m.id);
  const [
    photoRows,
    itemRows,
    foodRows,
    memoryRows,
    targetRows,
    medicineRows,
    medicineLogRows,
    activityRows,
    badgeRows,
    measurementRows,
    healthRows,
    bodySessions,
  ] = await Promise.all([
    ids.length ? dbx.select().from(mealPhotos).where(inArray(mealPhotos.mealId, ids)) : [],
    ids.length
      ? dbx
          .select({ item: mealItems, foodName: foods.nameEn })
          .from(mealItems)
          .leftJoin(foods, eq(foods.id, mealItems.foodId))
          .where(eq(mealItems.userId, userId))
      : [],
    dbx.select().from(foods).where(eq(foods.ownerId, userId)).orderBy(asc(foods.createdAt)),
    dbx.select().from(foodMemory).where(eq(foodMemory.userId, userId)),
    dbx
      .select()
      .from(userTargets)
      .where(and(eq(userTargets.userId, userId), eq(userTargets.custom, true))),
    dbx
      .select()
      .from(medicines)
      .where(eq(medicines.userId, userId))
      .orderBy(asc(medicines.createdAt)),
    dbx
      .select()
      .from(medicineLogs)
      .where(eq(medicineLogs.userId, userId))
      .orderBy(asc(medicineLogs.takenAt)),
    dbx
      .select()
      .from(activities)
      .where(eq(activities.userId, userId))
      .orderBy(asc(activities.startedAt)),
    dbx
      .select()
      .from(userBadges)
      .where(eq(userBadges.userId, userId))
      .orderBy(asc(userBadges.earnedOn)),
    dbx
      .select()
      .from(bodyMeasurements)
      .where(eq(bodyMeasurements.userId, userId))
      .orderBy(asc(bodyMeasurements.measuredAt), asc(bodyMeasurements.code)),
    dbx.select().from(healthProfiles).where(eq(healthProfiles.userId, userId)),
    listBodySessions(userId, dbx),
  ]);

  return {
    format: "cal-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    account: {
      username: user.username,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
      profile: {
        sex: user.sex,
        birthYear: user.birthYear,
        heightCm: user.heightCm,
        weightKg: user.weightKg,
        activityLevel: user.activityLevel,
        goal: user.goal,
        goalRateKgPerWeek: user.goalRateKgPerWeek,
      },
      preferences: {
        timeZone: user.timeZone,
        units: user.units,
        mealWindows: user.mealWindows,
        cuisines: user.cuisines,
        notifications: user.notifications,
      },
    },
    targets: targetRows.map((t) => ({
      code: t.nutrientCode,
      target: t.target,
      upper: t.upper,
      kind: t.kind,
    })),
    meals: mealRows.map((row) =>
      toMealDto(
        row,
        photoRows.filter((p) => p.mealId === row.id),
        itemRows
          .filter((i) => i.item.mealId === row.id)
          .map((i) => ({ row: i.item, foodName: i.foodName })),
      ),
    ),
    personalFoods: foodRows.map((f) => ({
      id: f.id,
      nameEn: f.nameEn,
      nameFa: f.nameFa,
      brand: f.brand,
      barcode: f.barcode,
      servingGrams: f.servingGrams,
      per100g: f.nutrients,
    })),
    memory: memoryRows.map((m) => ({
      name: m.displayName,
      foodId: m.foodId,
      typicalGrams: m.typicalGrams,
      count: m.count,
    })),
    medicines: medicineRows.map((m) => toMedicineDto(m)),
    medicineLogs: medicineLogRows.map(toLogDto),
    activities: activityRows.map(toActivityDto),
    badges: badgeRows.map((b) => ({ code: b.code, earnedOn: b.earnedOn })),
    bodyMeasurements: measurementRows.map(toMeasurementDto),
    healthProfile: {
      conditions: healthRows[0]?.conditions ?? "",
      allergies: healthRows[0]?.allergies ?? "",
      notes: healthRows[0]?.notes ?? "",
      useInAnalysis: healthRows[0]?.useInAnalysis ?? false,
    },
    bodyPhotos: [...bodySessions].reverse(),
  };
};

/** The nutrients written as CSV columns, in catalogue order. */
const CSV_NUTRIENTS = NUTRIENT_CATALOGUE.map((n) => n.code);

/** One CSV field, quoted when needed; leading formula characters are neutralised. */
export const csvField = (value: unknown) => {
  if (value === null || value === undefined) return "";
  let text = typeof value === "number" ? String(Math.round(value * 100) / 100) : String(value);
  if (/^[=+\-@\t\r]/.test(text) && typeof value !== "number") text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * One row per item (a meal without items gets one row with its totals): day, time, meal, food,
 * amount and every nutrient with its unit in the header.
 */
export const mealsToCsv = (data: Pick<ExportData, "meals">) => {
  const header = [
    "date",
    "time",
    "time_zone",
    "slot",
    "meal",
    "status",
    "item",
    "local_name",
    "matched_food",
    "grams",
    "ml",
    "count",
    "portion",
    "nutrient_source",
    ...CSV_NUTRIENTS.map((code) => {
      const info = NUTRIENT_CATALOGUE.find((n) => n.code === code)!;
      return `${code}_${info.unit === "µg" ? "ug" : info.unit}`;
    }),
  ];
  const lines = [header.join(",")];
  for (const meal of data.meals) {
    const base = [meal.localDate, meal.localTime, meal.tz, meal.slot, meal.title, meal.status];
    const rows = meal.items.length
      ? meal.items.map((item) => [
          ...base,
          item.name,
          item.localName,
          item.foodName,
          item.grams,
          item.ml,
          item.count,
          item.portionText,
          item.nutrientSource,
          ...CSV_NUTRIENTS.map((code) => item.nutrients[code]),
        ])
      : [[...base, "", "", "", "", "", "", "", "", ...CSV_NUTRIENTS.map((c) => meal.totals[c])]];
    for (const row of rows) lines.push(row.map(csvField).join(","));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
};

/**
 * Deletes the person's data (see the comment at the top) and returns how many meals went. Photo
 * files are removed after the rows, so a failure leaves at most unreferenced files behind.
 */
export const deleteUserData = async (userId: string, dbx: DbOrTx = defaultDb) => {
  const photos = [
    ...(await dbx
      .select({
        original: mealPhotos.originalPath,
        analysis: mealPhotos.analysisPath,
        thumb: mealPhotos.thumbPath,
      })
      .from(mealPhotos)
      .where(eq(mealPhotos.userId, userId))),
    ...(await dbx
      .select({
        original: medicineScans.originalPath,
        analysis: medicineScans.analysisPath,
        thumb: medicineScans.thumbPath,
      })
      .from(medicineScans)
      .where(eq(medicineScans.userId, userId))),
  ];
  const bodyFiles = await bodyPhotoFiles(userId, dbx);
  const removed = await dbx.transaction(async (tx) => {
    // Items first: they may point at the person's own foods.
    await tx.delete(mealItems).where(eq(mealItems.userId, userId));
    const gone = await tx.delete(meals).where(eq(meals.userId, userId)).returning({ id: meals.id });
    await tx.delete(foodMemory).where(eq(foodMemory.userId, userId));
    // Logs first: they point at the medicines and the label photos.
    await tx.delete(medicineLogs).where(eq(medicineLogs.userId, userId));
    await tx.delete(medicines).where(eq(medicines.userId, userId));
    await tx.delete(medicineScans).where(eq(medicineScans.userId, userId));
    await tx.delete(activities).where(eq(activities.userId, userId));
    await tx.delete(userBadges).where(eq(userBadges.userId, userId));
    await tx.delete(bodyMeasurements).where(eq(bodyMeasurements.userId, userId));
    await tx.delete(healthProfiles).where(eq(healthProfiles.userId, userId));
    // Sessions take their photos with them (ON DELETE CASCADE).
    await tx.delete(bodyPhotoSessions).where(eq(bodyPhotoSessions.userId, userId));
    // Parts of their own dishes first: a dish part may be another of their own foods, which
    // dish_components protects (ON DELETE RESTRICT) until the part row is gone.
    const ownFoods = tx.select({ id: foods.id }).from(foods).where(eq(foods.ownerId, userId));
    await tx.delete(dishComponents).where(inArray(dishComponents.dishId, ownFoods));
    await tx.delete(foods).where(eq(foods.ownerId, userId));
    await tx.delete(aiKeys).where(eq(aiKeys.userId, userId));
    await tx.delete(aiSettings).where(eq(aiSettings.userId, userId));
    await tx.delete(aiUsage).where(eq(aiUsage.userId, userId));
    await tx.delete(integrations).where(eq(integrations.userId, userId));
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    await tx.delete(userTargets).where(eq(userTargets.userId, userId));
    await tx.delete(jobs).where(and(eq(jobs.userId, userId), eq(jobs.status, "queued")));
    await tx
      .update(users)
      .set({
        sex: null,
        birthYear: null,
        heightCm: null,
        weightKg: null,
        activityLevel: null,
        goal: null,
        goalRateKgPerWeek: null,
        cuisines: [],
        mealWindows: DEFAULT_MEAL_WINDOWS,
        notifications: { analysisReady: false, questions: false },
      })
      .where(eq(users.id, userId));
    await audit({ userId, action: "data.delete", details: { meals: gone.length } }, tx);
    return gone.length;
  });
  await removePhotoFiles([
    ...photos.flatMap((p) => [p.original, p.analysis, p.thumb]),
    ...bodyFiles,
  ]).catch(() => undefined);
  return { meals: removed };
};
