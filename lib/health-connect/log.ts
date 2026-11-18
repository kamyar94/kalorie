// The update log of linked phones (CONTRACT: lib/contracts/health-connect.ts): one row per batch
// the server accepted from /api/health-connect/sync, with counts only (how many records of each
// kind it held, what was stored), never ids, times or values (the phone's step total for the day
// it sent is the one number kept, for "6,812 steps today"). Rows older than UPDATE_LOG_DAYS go
// when a phone writes; unlinking a phone removes its rows, and Delete my data removes them all.
// Every function that takes a user id reads only that person's rows.
import { and, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import {
  activities,
  bodyMeasurements,
  devices,
  healthConnectUpdates,
  heartRates,
  sleepSessions,
} from "@/db/schema";
import { PHONE_STEP_COUNTER, SAMSUNG_HEALTH_APPS, STEPS_TYPE } from "@/lib/contracts/activities";
import {
  UPDATE_LOG_DAYS,
  type HcSyncResult,
  type HcUpdateCounts,
  type HcUpdateDto,
} from "@/lib/contracts/health-connect";
import { isUuid } from "@/lib/meals/service";
import { localParts } from "@/lib/meals/time";

import type { CheckedBatch } from "./parse";

type UpdateRow = typeof healthConnectUpdates.$inferSelect;

/** What a checked batch held, counted; `at` is when it arrived (for the phone's "today"). */
export const countBatch = (
  batch: CheckedBatch,
  at: Date = new Date(),
): Omit<HcUpdateCounts, "skipped" | "added" | "written" | "removed"> => {
  const today = localParts(at, batch.tz).date;
  const stepDays = batch.steps.filter((s) => s.count > 0).length;
  const counts = {
    firstReadDays: batch.firstReadDays,
    stepDays,
    stepDaysZero: batch.steps.length - stepDays,
    stepsToday: batch.steps.find((s) => s.date === today && s.count > 0)?.count ?? null,
    workouts: batch.workouts.length,
    restingDays: batch.restingHeartRate.filter((r) => r.bpm !== null).length,
    sleepSessions: batch.sleep.length,
    bodyRecords: batch.body.length,
    weighIns: batch.body.filter((b) => b.code === "weight").length,
    height: batch.height !== null,
    deleted: batch.deleted.length,
  };
  const records =
    counts.stepDays +
    counts.workouts +
    counts.restingDays +
    counts.sleepSessions +
    counts.bodyRecords +
    (counts.height ? 1 : 0);
  return { ...counts, empty: records === 0 };
};

const toUpdateDto = (row: UpdateRow): HcUpdateDto => ({
  id: row.id,
  deviceId: row.deviceId,
  receivedAt: row.receivedAt.toISOString(),
  tz: row.tz,
  appVersion: row.appVersion,
  firstReadDays: row.firstReadDays,
  stepDays: row.stepDays,
  stepDaysZero: row.stepDaysZero,
  stepsToday: row.stepsToday,
  workouts: row.workouts,
  restingDays: row.restingDays,
  sleepSessions: row.sleepSessions,
  bodyRecords: row.bodyRecords,
  weighIns: row.weighIns,
  height: row.height,
  deleted: row.deleted,
  skipped: row.skipped,
  added: row.added,
  written: row.written,
  removed: row.removed,
  empty: row.empty,
});

const olderThanKept = sql`now() - make_interval(days => ${UPDATE_LOG_DAYS})`;

/**
 * Notes one accepted batch in the phone's log and removes the person's rows older than
 * UPDATE_LOG_DAYS.
 */
export const recordUpdate = async (
  device: { id: string; userId: string },
  batch: CheckedBatch,
  result: HcSyncResult,
  dbx: DbOrTx = defaultDb,
) => {
  const counts = countBatch(batch);
  await dbx.insert(healthConnectUpdates).values({
    deviceId: device.id,
    userId: device.userId,
    tz: batch.tz,
    appVersion: batch.appVersion?.slice(0, 40) ?? null,
    ...counts,
    skipped: result.skipped,
    added: result.added,
    written: result.added + result.updated,
    removed: result.removed,
  });
  await dbx
    .delete(healthConnectUpdates)
    .where(
      and(
        eq(healthConnectUpdates.userId, device.userId),
        lt(healthConnectUpdates.receivedAt, olderThanKept),
      ),
    );
};

/**
 * The latest `limit` updates of each of the person's phones in `deviceIds` (newest first) and how
 * many each sent in the kept window.
 */
export const listUpdates = async (
  userId: string,
  deviceIds: string[],
  limit = 10,
  dbx: DbOrTx = defaultDb,
): Promise<Map<string, { updates: HcUpdateDto[]; count: number }>> => {
  const out = new Map<string, { updates: HcUpdateDto[]; count: number }>();
  const ids = deviceIds.filter(isUuid);
  if (!isUuid(userId) || !ids.length) return out;
  for (const id of ids) out.set(id, { updates: [], count: 0 });
  const kept = and(
    eq(healthConnectUpdates.userId, userId),
    inArray(healthConnectUpdates.deviceId, ids),
    sql`${healthConnectUpdates.receivedAt} >= ${olderThanKept}`,
  );
  const ranked = dbx
    .select({
      id: healthConnectUpdates.id,
      rank: sql<number>`row_number() over (partition by ${healthConnectUpdates.deviceId} order by ${healthConnectUpdates.receivedAt} desc, ${healthConnectUpdates.id})`.as(
        "rank",
      ),
    })
    .from(healthConnectUpdates)
    .where(kept)
    .as("ranked");
  const [rows, counts] = await Promise.all([
    dbx
      .select({ row: healthConnectUpdates })
      .from(healthConnectUpdates)
      .innerJoin(ranked, eq(ranked.id, healthConnectUpdates.id))
      .where(sql`${ranked.rank} <= ${limit}`)
      .orderBy(desc(healthConnectUpdates.receivedAt), healthConnectUpdates.id),
    dbx
      .select({ deviceId: healthConnectUpdates.deviceId, n: sql<number>`count(*)::int` })
      .from(healthConnectUpdates)
      .where(kept)
      .groupBy(healthConnectUpdates.deviceId),
  ]);
  for (const { row } of rows) out.get(row.deviceId)?.updates.push(toUpdateDto(row));
  for (const { deviceId, n } of counts) {
    const entry = out.get(deviceId);
    if (entry) entry.count = Number(n);
  }
  return out;
};

/**
 * When one of the person's phones last sent an update: the newest row of the log, else (a phone
 * that sent before the log existed) the latest `last_sync_at` of their phones. Null when no phone
 * has sent anything.
 */
export const lastUpdateAt = async (userId: string, dbx: DbOrTx = defaultDb) => {
  if (!isUuid(userId)) return null;
  const [logged] = await dbx
    .select({ at: healthConnectUpdates.receivedAt })
    .from(healthConnectUpdates)
    .where(eq(healthConnectUpdates.userId, userId))
    .orderBy(desc(healthConnectUpdates.receivedAt))
    .limit(1);
  if (logged) return logged.at.toISOString();
  const [synced] = await dbx
    .select({ at: devices.lastSyncAt })
    .from(devices)
    .where(and(eq(devices.userId, userId), isNotNull(devices.lastSyncAt)))
    .orderBy(desc(devices.lastSyncAt))
    .limit(1);
  return synced?.at ? synced.at.toISOString() : null;
};

/** Every update of the person's phones in the kept window, oldest first (for the export). */
export const allUpdates = async (userId: string, dbx: DbOrTx = defaultDb) => {
  if (!isUuid(userId)) return [];
  const rows = await dbx
    .select()
    .from(healthConnectUpdates)
    .where(eq(healthConnectUpdates.userId, userId))
    .orderBy(healthConnectUpdates.receivedAt, healthConnectUpdates.id);
  return rows.map(toUpdateDto);
};

/** Removes a phone's log (when it is unlinked). */
export const removeUpdates = async (userId: string, deviceId: string, dbx: DbOrTx = defaultDb) => {
  if (!isUuid(userId) || !isUuid(deviceId)) return;
  await dbx
    .delete(healthConnectUpdates)
    .where(
      and(eq(healthConnectUpdates.userId, userId), eq(healthConnectUpdates.deviceId, deviceId)),
    );
};

/**
 * Whether any Health Connect record of the person is stored: an activity, body measurement,
 * heart rate or sleep session with source health_connect. "Kal for Android" warns while a phone
 * has sent updates and this is false.
 */
export const hasHealthConnectRecords = async (userId: string, dbx: DbOrTx = defaultDb) => {
  if (!isUuid(userId)) return false;
  const exists = (
    table: typeof activities | typeof bodyMeasurements | typeof heartRates | typeof sleepSessions,
  ) =>
    sql`exists (select 1 from ${table} where ${table.userId} = ${userId} and ${table.source} = 'health_connect')`;
  const result = await dbx.execute<{ found: boolean }>(
    sql`select (${exists(activities)} or ${exists(bodyMeasurements)} or ${exists(heartRates)} or ${exists(sleepSessions)}) as found`,
  );
  return Boolean(result.rows[0]?.found);
};

/**
 * Whether the person's Health Connect steps come only from the phone's own step counter (every
 * stored day names it as the one app) and nothing from Samsung Health has ever arrived through
 * Health Connect (no activity, body value, heart rate or sleep). Move then says that a watch's
 * steps come through Samsung Health.
 */
export const stepsOnlyFromPhone = async (userId: string, dbx: DbOrTx = defaultDb) => {
  if (!isUuid(userId)) return false;
  const hcSteps = sql`${activities.userId} = ${userId} and ${activities.source} = 'health_connect' and ${activities.type} = ${STEPS_TYPE}`;
  const phone = sql`(${activities.sourceApp} = ${PHONE_STEP_COUNTER} or starts_with(${activities.sourceApp}, ${`${PHONE_STEP_COUNTER}.`}))`;
  const samsung = sql.join(
    SAMSUNG_HEALTH_APPS.map((app) => sql`${app}`),
    sql`, `,
  );
  const fromSamsung = (
    table: typeof activities | typeof bodyMeasurements | typeof heartRates | typeof sleepSessions,
  ) =>
    sql`exists (select 1 from ${table} where ${table.userId} = ${userId} and ${table.source} = 'health_connect' and ${table.sourceApp} in (${samsung}))`;
  const result = await dbx.execute<{ phone: boolean; other: boolean; samsung: boolean }>(
    sql`select
      exists (select 1 from ${activities} where ${hcSteps} and ${phone}) as phone,
      exists (select 1 from ${activities} where ${hcSteps} and not coalesce(${phone}, false)) as other,
      (${fromSamsung(activities)} or ${fromSamsung(bodyMeasurements)} or ${fromSamsung(heartRates)} or ${fromSamsung(sleepSessions)}) as samsung`,
  );
  const row = result.rows[0];
  return Boolean(row?.phone) && !row?.other && !row?.samsung;
};
