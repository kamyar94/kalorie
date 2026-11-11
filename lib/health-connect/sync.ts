// Writes a checked batch from the Kal Android app (CONTRACT: lib/contracts/health-connect.ts) into
// the person's tables: steps and workouts into activities, body values into body_measurements,
// heart rate into heart_rates, sleep into sleep_sessions. Everything is keyed by (user, source
// "health_connect", external id), so sending a record again updates it; deletions remove by
// external id. Values are never logged.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { activities, bodyMeasurements, heartRates, sleepSessions, users } from "@/db/schema";
import { upsertActivities, type NewActivityRow } from "@/lib/activities/service";
import { upsertMeasurements, type NewMeasurementRow } from "@/lib/body/service";
import { activityType, STEPS_TYPE } from "@/lib/contracts/activities";
import { measureInfo, VALUE_LIMITS } from "@/lib/contracts/body";
import type { SendKind } from "@/lib/contracts/devices";
import type { HcSyncResult, HealthConnectKeptDto } from "@/lib/contracts/health-connect";
import { markDeviceSynced, type DeviceOwner } from "@/lib/devices/service";
import { isUuid } from "@/lib/meals/service";
import { localParts } from "@/lib/meals/time";
import { fromLocalInputValue } from "@/lib/ui/format";

import type { ParsedBatch } from "./parse";

const SOURCE = "health_connect" as const;

const noonOf = (date: string, tz: string) =>
  new Date(fromLocalInputValue(`${date}T12:00`, tz) ?? `${date}T12:00:00Z`);

const round1 = (value: number) => Math.round(value * 10) / 10;

const inserted = sql<boolean>`(xmax = 0)`;

type HeartRow = typeof heartRates.$inferInsert;
type SleepRow = typeof sleepSessions.$inferInsert;

const lastById = <T extends { externalId: string }>(rows: T[]) => [
  ...new Map(rows.map((r) => [r.externalId, r])).values(),
];

const upsertHeartRates = async (rows: HeartRow[], dbx: DbOrTx) => {
  if (!rows.length) return { added: 0, written: 0 };
  const unique = lastById(rows);
  const result = await dbx
    .insert(heartRates)
    .values(unique)
    .onConflictDoUpdate({
      target: [heartRates.userId, heartRates.source, heartRates.externalId],
      set: {
        kind: sql`excluded.kind`,
        localDate: sql`excluded.local_date`,
        tz: sql`excluded.tz`,
        startedAt: sql`excluded.started_at`,
        endedAt: sql`excluded.ended_at`,
        bpm: sql`excluded.bpm`,
        maxBpm: sql`excluded.max_bpm`,
        sourceApp: sql`excluded.source_app`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ inserted });
  return { added: result.filter((r) => r.inserted).length, written: unique.length };
};

const upsertSleep = async (rows: SleepRow[], dbx: DbOrTx) => {
  if (!rows.length) return { added: 0, written: 0 };
  const unique = lastById(rows);
  const result = await dbx
    .insert(sleepSessions)
    .values(unique)
    .onConflictDoUpdate({
      target: [sleepSessions.userId, sleepSessions.source, sleepSessions.externalId],
      set: {
        startedAt: sql`excluded.started_at`,
        endedAt: sql`excluded.ended_at`,
        tz: sql`excluded.tz`,
        localDate: sql`excluded.local_date`,
        durationMin: sql`excluded.duration_min`,
        stages: sql`excluded.stages`,
        title: sql`excluded.title`,
        sourceApp: sql`excluded.source_app`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ inserted });
  return { added: result.filter((r) => r.inserted).length, written: unique.length };
};

/** Removes Health Connect rows of the person by external id from every table they may be in. */
const removeByExternalId = async (userId: string, ids: string[], dbx: DbOrTx) => {
  if (!ids.length) return 0;
  let removed = 0;
  for (const table of [activities, bodyMeasurements, heartRates, sleepSessions]) {
    const gone = await dbx
      .delete(table)
      .where(
        and(eq(table.userId, userId), eq(table.source, SOURCE), inArray(table.externalId, ids)),
      )
      .returning({ id: table.id });
    removed += gone.length;
  }
  return removed;
};

/**
 * The weight to turn a body water mass into a share: the weigh-in of the same day closest in
 * time, from this batch or already stored (any source).
 */
const weightNear = async (
  userId: string,
  at: Date,
  localDate: string,
  batchWeights: { at: Date; localDate: string; kg: number }[],
  dbx: DbOrTx,
) => {
  const fromBatch = batchWeights
    .filter((w) => w.localDate === localDate)
    .sort(
      (a, b) => Math.abs(a.at.getTime() - at.getTime()) - Math.abs(b.at.getTime() - at.getTime()),
    )[0];
  if (fromBatch) return fromBatch.kg;
  const stored = await dbx
    .select({ value: bodyMeasurements.value })
    .from(bodyMeasurements)
    .where(
      and(
        eq(bodyMeasurements.userId, userId),
        eq(bodyMeasurements.code, "weight"),
        eq(bodyMeasurements.localDate, localDate),
      ),
    )
    .orderBy(
      sql`abs(extract(epoch from (${bodyMeasurements.measuredAt} - ${at.toISOString()}::timestamptz)))`,
    )
    .limit(1);
  return stored[0]?.value ?? null;
};

/** Writes one checked batch for the phone's owner and notes the sync on the phone's row. */
export const applyHealthConnectBatch = async (
  owner: DeviceOwner,
  { batch, skipped: skippedBefore }: ParsedBatch,
  dbx: DbOrTx = defaultDb,
): Promise<HcSyncResult> => {
  const userId = owner.user.id;
  const tz = batch.tz;
  let skipped = skippedBefore;

  const counts = await dbx.transaction(async (tx) => {
    let added = 0;
    let written = 0;
    const count = (r: { added: number; written: number }) => {
      added += r.added;
      written += r.written;
    };

    // Deletions first, so a record deleted and made again in one read ends up stored.
    let removed = await removeByExternalId(userId, batch.deleted, tx);

    // Steps: one row per day; a day total of 0 means the day has none left.
    const emptyDays = batch.steps.filter((s) => s.count === 0).map((s) => `steps:${s.date}`);
    removed += await removeByExternalId(userId, emptyDays, tx);
    const activityRows: NewActivityRow[] = batch.steps
      .filter((s) => s.count > 0)
      .map((s) => ({
        userId,
        category: "walking",
        type: STEPS_TYPE,
        title: "Steps",
        startedAt: noonOf(s.date, tz),
        tz,
        localDate: s.date,
        durationMin: null,
        distanceM: null,
        steps: s.count,
        energyKcal: null,
        intensity: null,
        source: SOURCE,
        sourceApp: s.sourceApp ?? null,
        externalId: `steps:${s.date}`,
        details: {},
      }));

    // Workouts, with their heart rate kept apart.
    const heartRows: HeartRow[] = [];
    const noHeartRate: string[] = [];
    for (const w of batch.workouts) {
      const start = new Date(w.start);
      const end = new Date(w.end);
      const localDate = w.localDate ?? localParts(start, tz).date;
      activityRows.push({
        userId,
        category: w.category,
        type: w.type,
        title: w.title,
        startedAt: start,
        tz,
        localDate,
        durationMin: round1((end.getTime() - start.getTime()) / 60_000),
        distanceM: w.distanceM ?? null,
        steps: w.steps || null,
        energyKcal: w.energyKcal ? Math.round(w.energyKcal) : null,
        intensity: activityType(w.type)?.intensity ?? "moderate",
        source: SOURCE,
        sourceApp: w.sourceApp ?? null,
        externalId: w.id,
        details: { endedAt: end.toISOString() },
      });
      if (w.avgHeartRate)
        heartRows.push({
          userId,
          kind: "workout",
          localDate,
          tz,
          startedAt: start,
          endedAt: end,
          bpm: round1(w.avgHeartRate),
          maxBpm: w.maxHeartRate ? round1(w.maxHeartRate) : null,
          source: SOURCE,
          sourceApp: w.sourceApp ?? null,
          externalId: w.id,
        });
      else noHeartRate.push(w.id);
    }
    if (activityRows.length) count(await upsertActivities(activityRows, tx));
    if (noHeartRate.length)
      await tx
        .delete(heartRates)
        .where(
          and(
            eq(heartRates.userId, userId),
            eq(heartRates.source, SOURCE),
            eq(heartRates.kind, "workout"),
            inArray(heartRates.externalId, noHeartRate),
          ),
        );

    // Resting heart rate per day; null means the day has none left.
    const restingGone = batch.restingHeartRate
      .filter((r) => r.bpm === null)
      .map((r) => `resting:${r.date}`);
    removed += await removeByExternalId(userId, restingGone, tx);
    for (const r of batch.restingHeartRate)
      if (r.bpm !== null)
        heartRows.push({
          userId,
          kind: "resting",
          localDate: r.date,
          tz,
          startedAt: noonOf(r.date, tz),
          endedAt: null,
          bpm: round1(r.bpm),
          maxBpm: null,
          source: SOURCE,
          sourceApp: r.sourceApp ?? null,
          externalId: `resting:${r.date}`,
        });
    count(await upsertHeartRates(heartRows, tx));

    // Body values. Body water comes as a mass and is stored as a share of the day's weight.
    const weights = batch.body
      .filter((b) => b.code === "weight")
      .map((b) => {
        const at = new Date(b.at);
        return { at, localDate: localParts(at, tz).date, kg: b.value };
      });
    const bodyRows: NewMeasurementRow[] = [];
    for (const b of batch.body) {
      const at = new Date(b.at);
      const localDate = localParts(at, tz).date;
      let code: string = b.code;
      let value = b.value;
      if (b.code === "water_mass") {
        const kg = await weightNear(userId, at, localDate, weights, tx);
        if (!kg || b.value >= kg) {
          skipped += 1;
          continue;
        }
        code = "water";
        value = round1((b.value / kg) * 100);
      }
      const info = measureInfo(code)!;
      const [low, high] = VALUE_LIMITS[info.unit] ?? [0, Infinity];
      if (value < low || value > high) {
        skipped += 1;
        continue;
      }
      bodyRows.push({
        userId,
        code,
        label: null,
        unit: info.unit,
        value: info.decimals === 0 ? Math.round(value) : Math.round(value * 100) / 100,
        measuredAt: at,
        tz,
        localDate,
        source: SOURCE,
        sourceApp: b.sourceApp ?? null,
        externalId: b.id,
      });
    }
    if (bodyRows.length) {
      const result = await upsertMeasurements(bodyRows, tx);
      count({ added: result.added, written: result.written.length });
    }

    // Sleep: the night belongs to the day the person woke up.
    count(
      await upsertSleep(
        batch.sleep.map((s) => {
          const start = new Date(s.start);
          const end = new Date(s.end);
          return {
            userId,
            startedAt: start,
            endedAt: end,
            tz,
            localDate: localParts(end, tz).date,
            durationMin: round1((end.getTime() - start.getTime()) / 60_000),
            stages: s.stages ?? {},
            title: s.title || null,
            source: SOURCE,
            sourceApp: s.sourceApp ?? null,
            externalId: s.id,
          };
        }),
        tx,
      ),
    );

    // Height only fills an empty profile height; what the person typed stays.
    if (batch.height)
      await tx
        .update(users)
        .set({ heightCm: round1(batch.height.cm) })
        .where(and(eq(users.id, userId), isNull(users.heightCm)));

    return { added, updated: written - added, removed };
  });

  const sent: SendKind[] = [];
  if (batch.steps.length) sent.push("steps");
  if (batch.workouts.length) sent.push("workouts");
  if (batch.restingHeartRate.length || batch.workouts.some((w) => w.avgHeartRate))
    sent.push("heart_rate");
  if (batch.sleep.length) sent.push("sleep");
  if (batch.body.some((b) => b.code === "weight")) sent.push("weight");
  if (batch.body.some((b) => b.code !== "weight") || batch.height) sent.push("body");
  await markDeviceSynced(owner.device, sent, batch.appVersion, dbx);
  return { ...counts, skipped };
};

/** The counts "Kal for Android" shows for the records kept for later charts. */
export const keptHealthConnect = async (
  userId: string,
  dbx: DbOrTx = defaultDb,
): Promise<HealthConnectKeptDto> => {
  if (!isUuid(userId)) return { restingDays: 0, workoutHeartRates: 0, sleepNights: 0 };
  const result = await dbx.execute<{ resting: string; workout: string; sleep: string }>(sql`
    select
      (select count(*) from heart_rates where user_id = ${userId} and kind = 'resting') as resting,
      (select count(*) from heart_rates where user_id = ${userId} and kind = 'workout') as workout,
      (select count(*) from sleep_sessions where user_id = ${userId}) as sleep`);
  const row = result.rows[0];
  return {
    restingDays: Number(row?.resting ?? 0),
    workoutHeartRates: Number(row?.workout ?? 0),
    sleepNights: Number(row?.sleep ?? 0),
  };
};
