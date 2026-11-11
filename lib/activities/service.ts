// Activities (CONTRACT: lib/contracts/activities.ts): what the person typed, openGym workouts and
// imported records, in one table. Every function takes the signed-in person's id and touches only
// their rows; another person's id behaves like one that does not exist. Values are never logged.
import { and, asc, desc, eq, gte, lte, notInArray, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { activities, users } from "@/db/schema";
import {
  activityType,
  categoryFromWords,
  energyEstimate,
  metOf,
  TYPE_OF_CATEGORY,
  type ActivityDto,
  type ImportedActivity,
  type ImportResult,
  type Intensity,
  type ManualActivityInput,
} from "@/lib/contracts/activities";
import { metFor, type CachedWorkout } from "@/lib/integrations/opengym/parse";
import { isUuid } from "@/lib/meals/service";
import { isValidTimeZone, localParts } from "@/lib/meals/time";
import { bodyWeightOn } from "@/lib/body/weight";
import { fromLocalInputValue } from "@/lib/ui/format";

type ActivityRow = typeof activities.$inferSelect;

export const toActivityDto = (row: ActivityRow): ActivityDto => ({
  id: row.id,
  category: row.category,
  type: row.type,
  title: row.title,
  startedAt: row.startedAt.toISOString(),
  tz: row.tz,
  localDate: row.localDate,
  localTime: localParts(row.startedAt, row.tz).time,
  durationMin: row.durationMin,
  distanceM: row.distanceM,
  steps: row.steps,
  energyKcal: row.energyKcal,
  intensity: row.intensity,
  source: row.source,
  sourceApp: row.sourceApp,
  notes: row.notes,
});

/** The person's activities between two local days (both included), newest first. */
export const listActivities = async (
  userId: string,
  options: { from?: string; to?: string; limit?: number } = {},
  dbx: DbOrTx = defaultDb,
): Promise<ActivityDto[]> => {
  if (!isUuid(userId)) return [];
  const rows = await dbx
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.userId, userId),
        options.from ? gte(activities.localDate, options.from) : undefined,
        options.to ? lte(activities.localDate, options.to) : undefined,
      ),
    )
    .orderBy(desc(activities.localDate), desc(activities.startedAt), asc(activities.id))
    .limit(Math.max(1, Math.min(5000, options.limit ?? 500)));
  return rows.map(toActivityDto);
};

/** "+ Activity": stores what the person typed, with an energy estimate when Kal knows a weight. */
export const createActivity = async (
  userId: string,
  input: ManualActivityInput,
  dbx: DbOrTx = defaultDb,
): Promise<ActivityDto | null> => {
  const type = activityType(input.type);
  const startedAt = new Date(input.startedAt);
  if (!isUuid(userId) || !type || Number.isNaN(startedAt.getTime()) || !isValidTimeZone(input.tz))
    return null;
  const localDate = localParts(startedAt, input.tz).date;
  const minutes = type.steps ? null : (input.durationMin ?? null);
  const intensity: Intensity | null = type.steps ? null : (input.intensity ?? type.intensity);
  const kg = minutes ? await bodyWeightOn(userId, localDate, dbx) : null;
  const met = metOf(type.category, intensity);
  const [row] = await dbx
    .insert(activities)
    .values({
      userId,
      category: type.category,
      type: type.id,
      title: input.title || type.label,
      startedAt,
      tz: input.tz,
      localDate,
      durationMin: minutes,
      distanceM: input.distanceKm ? input.distanceKm * 1000 : null,
      steps: input.steps ?? null,
      energyKcal: energyEstimate(met, kg, minutes),
      intensity,
      source: "manual",
      notes: input.notes ?? null,
    })
    .returning();
  return row ? toActivityDto(row) : null;
};

/**
 * Removes an activity. openGym workouts come back with the next sync, so they are removed in
 * openGym ("synced").
 */
export const deleteActivity = async (
  userId: string,
  id: string,
  dbx: DbOrTx = defaultDb,
): Promise<"deleted" | "not-found" | "synced"> => {
  if (!isUuid(userId) || !isUuid(id)) return "not-found";
  const row = (
    await dbx
      .select({ source: activities.source })
      .from(activities)
      .where(and(eq(activities.id, id), eq(activities.userId, userId)))
      .limit(1)
  )[0];
  if (!row) return "not-found";
  if (row.source === "opengym") return "synced";
  await dbx.delete(activities).where(and(eq(activities.id, id), eq(activities.userId, userId)));
  return "deleted";
};

const UPDATE_FROM_EXCLUDED = {
  category: sql`excluded.category`,
  type: sql`excluded.type`,
  title: sql`excluded.title`,
  startedAt: sql`excluded.started_at`,
  tz: sql`excluded.tz`,
  localDate: sql`excluded.local_date`,
  durationMin: sql`excluded.duration_min`,
  distanceM: sql`excluded.distance_m`,
  steps: sql`excluded.steps`,
  energyKcal: sql`excluded.energy_kcal`,
  intensity: sql`excluded.intensity`,
  sourceApp: sql`excluded.source_app`,
  details: sql`excluded.details`,
  updatedAt: sql`now()`,
};

export type NewActivityRow = typeof activities.$inferInsert & { externalId: string };

/**
 * Inserts or updates rows by (user, source, external id); counts what was new. Used by imports,
 * openGym syncs and Health Connect (lib/health-connect/sync.ts).
 */
export const upsertActivities = async (rows: NewActivityRow[], dbx: DbOrTx) => {
  // One statement may not touch the same row twice: the last record of an id wins.
  const unique = [...new Map(rows.map((r) => [`${r.source}|${r.externalId}`, r])).values()];
  let added = 0;
  for (let i = 0; i < unique.length; i += 500) {
    const result = await dbx
      .insert(activities)
      .values(unique.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [activities.userId, activities.source, activities.externalId],
        set: UPDATE_FROM_EXCLUDED,
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    added += result.filter((r) => r.inserted).length;
  }
  return { added, written: unique.length };
};

/** Records read from an export file (lib/imports), stored once per external id. */
export const importActivities = async (
  userId: string,
  records: ImportedActivity[],
  dbx: DbOrTx = defaultDb,
): Promise<ImportResult> => {
  if (!isUuid(userId) || !records.length) return { added: 0, updated: 0, skipped: 0 };
  const rows: NewActivityRow[] = records.map((r) => {
    const startedAt = new Date(r.startedAt);
    return {
      userId,
      category: r.category,
      type: r.type,
      title: r.title,
      startedAt,
      tz: r.tz,
      localDate: r.localDate ?? localParts(startedAt, r.tz).date,
      durationMin: r.durationMin ?? null,
      distanceM: r.distanceM ?? null,
      steps: r.steps ?? null,
      energyKcal: r.energyKcal ?? null,
      intensity: r.intensity ?? (r.durationMin ? "moderate" : null),
      source: "import",
      sourceApp: r.sourceApp,
      externalId: r.externalId,
      details: {},
    };
  });
  const { added, written } = await upsertActivities(rows, dbx);
  return { added, updated: written - added, skipped: 0 };
};

const intensityOfMet = (met: number): Intensity =>
  met >= 6 ? "vigorous" : met >= 3 ? "moderate" : "light";

/**
 * Writes openGym's workouts as activities (after every sync). Workouts that openGym no longer
 * lists, from `windowStart` on (the days the sync reads), are removed here too.
 */
export const syncOpenGymActivities = async (
  userId: string,
  workouts: CachedWorkout[],
  windowStart: string,
  dbx: DbOrTx = defaultDb,
) => {
  if (!isUuid(userId)) return;
  const user = (
    await dbx.select({ tz: users.timeZone }).from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  const tz = user && isValidTimeZone(user.tz) ? user.tz : "UTC";
  const rows: NewActivityRow[] = [];
  for (const w of workouts) {
    const words = `${w.name} ${w.exercises.join(" ")}`;
    const category = categoryFromWords(words);
    const met = metFor(words).met;
    const kg = w.bwKg ?? (w.durationMin ? await bodyWeightOn(userId, w.date, dbx) : null);
    const startedAt = w.start
      ? new Date(w.start)
      : new Date(fromLocalInputValue(`${w.date}T12:00`, tz) ?? `${w.date}T12:00:00Z`);
    rows.push({
      userId,
      category,
      type: TYPE_OF_CATEGORY[category],
      title: w.name,
      startedAt,
      tz,
      localDate: w.date,
      durationMin: w.durationMin,
      distanceM: null,
      steps: null,
      energyKcal: energyEstimate(met, kg, w.durationMin),
      intensity: intensityOfMet(met),
      source: "opengym",
      sourceApp: null,
      externalId: w.id,
      details: { exercises: w.exercises.slice(0, 30) },
    });
  }
  await dbx.transaction(async (tx) => {
    if (rows.length) await upsertActivities(rows, tx);
    await tx.delete(activities).where(
      and(
        eq(activities.userId, userId),
        eq(activities.source, "opengym"),
        gte(activities.localDate, windowStart),
        rows.length
          ? notInArray(
              activities.externalId,
              rows.map((r) => r.externalId),
            )
          : undefined,
      ),
    );
  });
};

/** Activities of several days, for the summaries (oldest first). */
export const activitiesBetween = async (
  userId: string,
  from: string | null,
  to: string,
  dbx: DbOrTx = defaultDb,
) => {
  if (!isUuid(userId)) return [];
  return dbx
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.userId, userId),
        from ? gte(activities.localDate, from) : undefined,
        lte(activities.localDate, to),
      ),
    )
    .orderBy(asc(activities.localDate), asc(activities.startedAt));
};
