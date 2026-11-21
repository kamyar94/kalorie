// Each day's steps, active time and activity calories as the phone counts them (Kal for Android
// 1.2; CONTRACT: lib/contracts/health-connect.ts, `dayTotals`). One row per person, local day and
// source; sending a day again replaces it, and a day sent with every number at 0 (or unknown) is
// removed. These are the phone's numbers, shown next to Kal's own workouts: Move's points, streak
// and WHO week keep counting the activities (lib/move/score.ts). Every function that takes a user
// id reads only that person's rows; values are never logged.
import { and, asc, between, eq, inArray, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { activityDayTotals } from "@/db/schema";
import { isEmptyDayTotal, type HcDayTotal } from "@/lib/contracts/health-connect";
import type { DayTotalDto } from "@/lib/contracts/move";
import { isUuid } from "@/lib/meals/service";

const SOURCE = "health_connect" as const;

type Row = typeof activityDayTotals.$inferSelect;

export const toDayTotalDto = (row: Row): DayTotalDto => ({
  date: row.localDate,
  steps: row.steps,
  stepsApp: row.stepsApp,
  activeMinutes: row.activeMinutes,
  activeMethod: row.activeMethod,
  activeApp: row.activeApp,
  activeKcal: row.activeKcal === null ? null : Math.round(row.activeKcal),
  kcalApp: row.kcalApp,
  updatedAt: row.updatedAt.toISOString(),
});

const inserted = sql<boolean>`(xmax = 0)`;

/**
 * Writes the day totals of one checked batch for the phone's owner: replaces each day sent, and
 * removes the days sent empty. The last day of a list wins when a batch names a day twice.
 */
export const writeDayTotals = async (
  device: { id: string; userId: string },
  tz: string,
  totals: HcDayTotal[],
  dbx: DbOrTx,
) => {
  if (!totals.length) return { added: 0, written: 0, removed: 0 };
  const byDay = [...new Map(totals.map((d) => [d.date, d])).values()];
  const empty = byDay.filter(isEmptyDayTotal).map((d) => d.date);
  const rows = byDay
    .filter((d) => !isEmptyDayTotal(d))
    .map((d) => ({
      userId: device.userId,
      deviceId: device.id,
      localDate: d.date,
      source: SOURCE,
      tz,
      steps: d.steps ?? null,
      stepsApp: d.steps ? (d.stepsApp ?? null) : null,
      activeMinutes: d.activeMinutes ?? null,
      // The method goes with a value; without one there is nothing it describes.
      activeMethod:
        d.activeMinutes !== null && d.activeMinutes !== undefined ? (d.activeMethod ?? null) : null,
      activeApp: d.activeMinutes ? (d.activeApp ?? null) : null,
      // As sent (the app rounds to a tenth); rounded once, when shown.
      activeKcal: d.activeKcal ?? null,
      kcalApp: d.activeKcal ? (d.kcalApp ?? null) : null,
    }));
  let removed = 0;
  if (empty.length)
    removed = (
      await dbx
        .delete(activityDayTotals)
        .where(
          and(
            eq(activityDayTotals.userId, device.userId),
            eq(activityDayTotals.source, SOURCE),
            inArray(activityDayTotals.localDate, empty),
          ),
        )
        .returning({ id: activityDayTotals.id })
    ).length;
  if (!rows.length) return { added: 0, written: 0, removed };
  const result = await dbx
    .insert(activityDayTotals)
    .values(rows)
    .onConflictDoUpdate({
      target: [activityDayTotals.userId, activityDayTotals.localDate, activityDayTotals.source],
      set: {
        deviceId: sql`excluded.device_id`,
        tz: sql`excluded.tz`,
        steps: sql`excluded.steps`,
        stepsApp: sql`excluded.steps_app`,
        activeMinutes: sql`excluded.active_minutes`,
        activeMethod: sql`excluded.active_method`,
        activeApp: sql`excluded.active_app`,
        activeKcal: sql`excluded.active_kcal`,
        kcalApp: sql`excluded.kcal_app`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ inserted });
  return { added: result.filter((r) => r.inserted).length, written: rows.length, removed };
};

/** The person's day totals between two local days (both included), oldest first. */
export const dayTotalsBetween = async (
  userId: string,
  from: string,
  to: string,
  dbx: DbOrTx = defaultDb,
): Promise<DayTotalDto[]> => {
  if (!isUuid(userId) || from > to) return [];
  const rows = await dbx
    .select()
    .from(activityDayTotals)
    .where(
      and(eq(activityDayTotals.userId, userId), between(activityDayTotals.localDate, from, to)),
    )
    .orderBy(asc(activityDayTotals.localDate));
  return rows.map(toDayTotalDto);
};

/** The day totals of one day, or null. */
export const dayTotalOn = async (userId: string, date: string, dbx: DbOrTx = defaultDb) =>
  (await dayTotalsBetween(userId, date, date, dbx))[0] ?? null;

/** Every day total of the person, oldest first (for the export). */
export const allDayTotals = async (userId: string, dbx: DbOrTx = defaultDb) => {
  if (!isUuid(userId)) return [];
  const rows = await dbx
    .select()
    .from(activityDayTotals)
    .where(eq(activityDayTotals.userId, userId))
    .orderBy(asc(activityDayTotals.localDate));
  return rows.map(toDayTotalDto);
};

/** The first local day with a day total, or null (the year's pager reaches back to it). */
export const firstDayTotal = async (userId: string, dbx: DbOrTx = defaultDb) => {
  if (!isUuid(userId)) return null;
  const [row] = await dbx
    .select({ first: sql<string | null>`min(${activityDayTotals.localDate})::text` })
    .from(activityDayTotals)
    .where(eq(activityDayTotals.userId, userId));
  return row?.first ?? null;
};
