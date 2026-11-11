// Checks a batch from the Kal Android app (CONTRACT: lib/contracts/health-connect.ts) with zod.
// The batch's shape must be right (else 400); a single record that is out of range, too old or of
// an unknown kind is left out and counted as skipped, so one odd record never blocks the rest.
import { z } from "zod";

import { ACTIVITY_CATEGORIES, ACTIVITY_LIMITS } from "@/lib/contracts/activities";
import {
  HC_BODY_CODES,
  HEALTH_CONNECT_LIMITS,
  SLEEP_STAGES,
  type HcBodyRecord,
  type HcRestingDay,
  type HcSleep,
  type HcStepsDay,
  type HcWorkout,
} from "@/lib/contracts/health-connect";
import { isValidTimeZone } from "@/lib/meals/time";

const DAY_MS = 86_400_000;

/** Health Connect record ids (UUIDs today) and Kal's own day keys. */
const recordId = z.string().regex(/^[\w.:@/+=-]{1,200}$/);
/** The package of the app that wrote a record ("com.sec.android.app.shealth"). */
const sourceApp = z
  .string()
  .max(150)
  .regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/)
  .nullish();
const instant = z.iso.datetime({ offset: true });
const day = z.iso.date();
const bpm = z.number().min(20).max(250);

const stepsDay = z.object({
  date: day,
  count: z.number().int().min(0).max(ACTIVITY_LIMITS.maxSteps),
  sourceApp,
});

const workout = z.object({
  id: recordId,
  category: z.enum(ACTIVITY_CATEGORIES),
  type: z.string().regex(/^[a-z_]{1,40}$/),
  title: z.string().trim().min(1).max(ACTIVITY_LIMITS.titleChars),
  start: instant,
  end: instant,
  localDate: day.nullish(),
  distanceM: z.number().min(0).max(ACTIVITY_LIMITS.maxDistance).nullish(),
  energyKcal: z.number().min(0).max(ACTIVITY_LIMITS.maxKcal).nullish(),
  steps: z.number().int().min(0).max(ACTIVITY_LIMITS.maxSteps).nullish(),
  avgHeartRate: bpm.nullish(),
  maxHeartRate: bpm.nullish(),
  sourceApp,
});

const bodyRecord = z.object({
  id: recordId,
  code: z.enum(HC_BODY_CODES),
  value: z.number().positive(),
  at: instant,
  sourceApp,
});

const restingDay = z.object({ date: day, bpm: bpm.nullable(), sourceApp });

const minutes = z
  .number()
  .min(0)
  .max(24 * 60);
const sleep = z.object({
  id: recordId,
  start: instant,
  end: instant,
  title: z.string().trim().max(ACTIVITY_LIMITS.titleChars).nullish(),
  stages: z.object(Object.fromEntries(SLEEP_STAGES.map((s) => [s, minutes.optional()]))).optional(),
  sourceApp,
});

const height = z.object({ cm: z.number().min(50).max(272), at: instant });

const list = (max: number) => z.array(z.unknown()).max(max).optional();

const batchShape = z.object({
  tz: z.string().refine(isValidTimeZone, "The time zone is not valid."),
  appVersion: z.string().max(40).nullish(),
  steps: list(HEALTH_CONNECT_LIMITS.batchRecords),
  workouts: list(HEALTH_CONNECT_LIMITS.batchRecords),
  body: list(HEALTH_CONNECT_LIMITS.batchRecords),
  height: z.unknown().optional(),
  restingHeartRate: list(HEALTH_CONNECT_LIMITS.batchRecords),
  sleep: list(HEALTH_CONNECT_LIMITS.batchRecords),
  deleted: z.array(recordId).max(HEALTH_CONNECT_LIMITS.deletedIds).optional(),
});

/** A batch after the checks: every list present, only usable records in it. */
export type CheckedBatch = {
  tz: string;
  appVersion: string | null;
  steps: HcStepsDay[];
  workouts: HcWorkout[];
  body: HcBodyRecord[];
  height: { cm: number; at: string } | null;
  restingHeartRate: HcRestingDay[];
  sleep: HcSleep[];
  deleted: string[];
};

export type ParsedBatch = { batch: CheckedBatch; skipped: number };

/** A moment the server accepts: from maxDaysBack ago to a day ahead (clocks differ). */
const inWindow = (iso: string, now: number) => {
  const ms = Date.parse(iso);
  return ms <= now + DAY_MS && ms >= now - HEALTH_CONNECT_LIMITS.maxDaysBack * DAY_MS;
};

const dayInWindow = (date: string, now: number) => inWindow(`${date}T12:00:00Z`, now);

const LISTS = ["steps", "workouts", "body", "restingHeartRate", "sleep"] as const;

/** Over the record limits: the answer is 413, not 400. */
export const TOO_MANY_RECORDS = `Send at most ${HEALTH_CONNECT_LIMITS.batchRecords} records and ${HEALTH_CONNECT_LIMITS.deletedIds} deletions at a time.`;

const lengthOf = (value: unknown) => (Array.isArray(value) ? value.length : 0);

/**
 * The checked batch with the usable records, or the reason it cannot be read at all (tooLarge
 * when it holds more records than one batch may).
 */
export const parseSyncBatch = (
  raw: unknown,
  now = Date.now(),
): ParsedBatch | { error: string; tooLarge: boolean } => {
  if (raw && typeof raw === "object") {
    const body = raw as Record<string, unknown>;
    const records = LISTS.reduce((sum, key) => sum + lengthOf(body[key]), 0);
    if (
      records > HEALTH_CONNECT_LIMITS.batchRecords ||
      lengthOf(body.deleted) > HEALTH_CONNECT_LIMITS.deletedIds
    )
      return { error: TOO_MANY_RECORDS, tooLarge: true };
  }
  const shape = batchShape.safeParse(raw);
  if (!shape.success) {
    const issue = shape.error.issues[0];
    const where = issue ? ` (${issue.path.join(".") || "body"}: ${issue.message})` : "";
    return { error: `The batch is not valid${where}.`, tooLarge: false };
  }
  const data = shape.data;

  let skipped = 0;
  const keep = <T>(items: unknown[] | undefined, schema: z.ZodType<T>, ok: (v: T) => boolean) =>
    (items ?? []).flatMap((item) => {
      const parsed = schema.safeParse(item);
      if (parsed.success && ok(parsed.data)) return [parsed.data];
      skipped += 1;
      return [];
    });

  const steps: HcStepsDay[] = keep(data.steps, stepsDay, (s) => dayInWindow(s.date, now));
  const workouts: HcWorkout[] = keep(data.workouts, workout, (w) => {
    const length = Date.parse(w.end) - Date.parse(w.start);
    return inWindow(w.start, now) && length > 0 && length <= DAY_MS;
  });
  const body: HcBodyRecord[] = keep(data.body, bodyRecord, (b) => inWindow(b.at, now));
  const restingHeartRate: HcRestingDay[] = keep(data.restingHeartRate, restingDay, (r) =>
    dayInWindow(r.date, now),
  );
  const sleepSessions: HcSleep[] = keep(data.sleep, sleep, (s) => {
    const length = Date.parse(s.end) - Date.parse(s.start);
    return inWindow(s.end, now) && length > 0 && length <= DAY_MS;
  });
  let heightValue: CheckedBatch["height"] = null;
  if (data.height !== undefined && data.height !== null) {
    const parsed = height.safeParse(data.height);
    if (parsed.success && inWindow(parsed.data.at, now)) heightValue = parsed.data;
    else skipped += 1;
  }

  return {
    batch: {
      tz: data.tz,
      appVersion: data.appVersion ?? null,
      steps,
      workouts,
      body,
      height: heightValue,
      restingHeartRate,
      sleep: sleepSessions,
      deleted: data.deleted ?? [],
    },
    skipped,
  };
};
