// CONTRACT: what the Kal Android app sends from Health Connect (POST /api/health-connect/sync with
// `Authorization: Bearer <device token>`). The phone reads the records the person allowed, maps
// them to Kal's words (the mapping lives in the app and has its own tests) and sends batches of
// this shape. Every record keeps Health Connect's record id as its external id and the package of
// the app that wrote it (`sourceApp`, for example Samsung Health's), so sending a record again
// updates it and a deletion in Health Connect removes it here.
//
//   steps            day totals from Health Connect's aggregate (it merges the phone and the
//                    watch), external id "steps:<day>"; count 0 removes the day
//   workouts         exercise sessions -> activities (Move, water); average and highest heart rate
//                    of the session -> heart_rates (kind "workout", the session's id)
//   body             weight, body fat, lean mass, bone mass, body water (mass, turned into a share
//                    of the day's weight here), BMR -> body_measurements; height fills the
//                    profile's height when it is empty
//   restingHeartRate the day's resting heart rate -> heart_rates (kind "resting", "resting:<day>");
//                    bpm null removes the day
//   sleep            sleep sessions with their stage minutes -> sleep_sessions
//   deleted          Health Connect record ids deleted on the phone
//
// Step totals from Health Connect win over other sources for the same day (lib/move/score.ts).
// Server: lib/health-connect/sync.ts (writes), lib/health-connect/parse.ts (zod checks).

import type { ActivityCategory } from "./activities";

export const HEALTH_CONNECT_LIMITS = {
  /** Records of all kinds in one request (the app sends larger reads in batches). */
  batchRecords: 2000,
  deletedIds: 5000,
  /** Bytes of one request body. */
  bodyBytes: 2 * 1024 * 1024,
  /** How far back a record may be (the first sync can read a year with the history permission). */
  maxDaysBack: 3 * 366,
} as const;

/** Body measures the app may send, with Kal's measure code for each. */
export const HC_BODY_CODES = [
  "weight",
  "body_fat",
  "fat_free",
  "bone",
  "water_mass",
  "bmr",
] as const;
export type HcBodyCode = (typeof HC_BODY_CODES)[number];

/** Sleep stage minutes, as Health Connect names the stages. */
export const SLEEP_STAGES = [
  "awake",
  "sleeping",
  "out_of_bed",
  "light",
  "deep",
  "rem",
  "unknown",
] as const;
export type SleepStage = (typeof SLEEP_STAGES)[number];

/** resting: one value per day; workout: the average and highest of one exercise session. */
export const HEART_RATE_KINDS = ["resting", "workout"] as const;
export type HeartRateKind = (typeof HEART_RATE_KINDS)[number];

export type HcStepsDay = { date: string; count: number; sourceApp?: string | null };

export type HcWorkout = {
  id: string;
  category: ActivityCategory;
  /** An ACTIVITY_TYPES id ("run"), or "other". */
  type: string;
  title: string;
  start: string;
  end: string;
  /** The local day of the start, in the zone the phone recorded it in. */
  localDate?: string | null;
  distanceM?: number | null;
  energyKcal?: number | null;
  steps?: number | null;
  avgHeartRate?: number | null;
  maxHeartRate?: number | null;
  sourceApp?: string | null;
};

export type HcBodyRecord = {
  id: string;
  code: HcBodyCode;
  /** kg for masses, % for body fat, kcal a day for BMR. */
  value: number;
  at: string;
  sourceApp?: string | null;
};

export type HcRestingDay = { date: string; bpm: number | null; sourceApp?: string | null };

export type HcSleep = {
  id: string;
  start: string;
  end: string;
  title?: string | null;
  stages?: Partial<Record<SleepStage, number>>;
  sourceApp?: string | null;
};

export type HcSyncBatch = {
  /** The phone's time zone (IANA). */
  tz: string;
  appVersion?: string | null;
  steps?: HcStepsDay[];
  workouts?: HcWorkout[];
  body?: HcBodyRecord[];
  height?: { cm: number; at: string } | null;
  restingHeartRate?: HcRestingDay[];
  sleep?: HcSleep[];
  deleted?: string[];
};

export type HcSyncResult = {
  added: number;
  updated: number;
  removed: number;
  /** Records the server could not use (out of range, unknown kind). */
  skipped: number;
};

/** What the Android page shows for the records kept for later charts. */
export type HealthConnectKeptDto = {
  restingDays: number;
  workoutHeartRates: number;
  sleepNights: number;
};
