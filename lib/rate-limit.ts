// Rate limits kept in the rate_limits table, so the app and the worker share them and they
// survive restarts. Fixed windows: each key + window name is one counter row that starts over
// when its window has passed. Times come from the database clock.
//
// Buckets used today (see the callers):
//   signin-ip:<ip>       failed sign-ins and code attempts per address   (lib/auth/login.ts)
//   upload:<userId>      photo uploads per account                       (app/api/meals/route.ts)
//   ai:<userId>          AI requests per account                         (lib/ai/service.ts)
import { sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";

export type RateWindow = {
  /** Short name that becomes part of the key, for example "min" or "day". */
  name: string;
  windowMs: number;
  max: number;
};

export type RateResult = { ok: boolean; retryAfter: number };

const keyFor = (bucket: string, window: RateWindow) => `${bucket}|${window.name}`;

type CounterRow = { count: number; retry: number };

const bump = async (dbx: DbOrTx, key: string, windowMs: number) => {
  const result = await dbx.execute<CounterRow>(sql`
    insert into rate_limits (key, count, reset_at)
    values (${key}, 1, now() + ${windowMs}::double precision * interval '1 millisecond')
    on conflict (key) do update set
      count = case when rate_limits.reset_at <= now() then 1 else rate_limits.count + 1 end,
      reset_at = case when rate_limits.reset_at <= now() then excluded.reset_at
                      else rate_limits.reset_at end
    returning count, ceil(extract(epoch from (reset_at - now())))::int as retry`);
  const row = result.rows[0];
  return { count: Number(row?.count ?? 0), retry: Math.max(1, Number(row?.retry ?? 1)) };
};

/**
 * Counts one request against every window of a bucket. ok is false when any window is over its
 * limit; refused requests count too, so hammering a limit does not reopen it.
 */
export const takeRateLimit = async (
  bucket: string,
  windows: RateWindow[],
  dbx: DbOrTx = defaultDb,
): Promise<RateResult> => {
  let retryAfter = 0;
  for (const window of windows) {
    const { count, retry } = await bump(dbx, keyFor(bucket, window), window.windowMs);
    if (count > window.max) retryAfter = Math.max(retryAfter, retry);
  }
  return { ok: retryAfter === 0, retryAfter };
};

/** Counts one event (for example a failed sign-in) without deciding anything. */
export const recordRateHit = async (
  bucket: string,
  window: RateWindow,
  dbx: DbOrTx = defaultDb,
) => {
  await bump(dbx, keyFor(bucket, window), window.windowMs);
};

/** Whether a bucket has reached its limit in the current window, without counting. */
export const isRateLimited = async (
  bucket: string,
  window: RateWindow,
  dbx: DbOrTx = defaultDb,
): Promise<RateResult> => {
  const result = await dbx.execute<CounterRow>(sql`
    select count, ceil(extract(epoch from (reset_at - now())))::int as retry
      from rate_limits where key = ${keyFor(bucket, window)} and reset_at > now()`);
  const row = result.rows[0];
  if (!row || Number(row.count) < window.max) return { ok: true, retryAfter: 0 };
  return { ok: false, retryAfter: Math.max(1, Number(row.retry)) };
};

/** Forgets a bucket in all its windows (after a successful sign-in, in tests). */
export const clearRateLimit = async (bucket: string, dbx: DbOrTx = defaultDb) => {
  await dbx.execute(
    sql`delete from rate_limits where key like ${`${bucket.replace(/[\\%_]/g, "\\$&")}|%`}`,
  );
};

/** Removes counters whose window has passed. Called now and then by the worker. */
export const pruneRateLimits = async (dbx: DbOrTx = defaultDb) => {
  await dbx.execute(sql`delete from rate_limits where reset_at <= now()`);
};

const fromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

/** Failed sign-ins and code attempts per address: 20 per 15 minutes. */
export const SIGNIN_IP_WINDOW: RateWindow = {
  name: "15m",
  windowMs: 15 * 60_000,
  max: fromEnv("SIGNIN_IP_MAX_FAILURES", 20),
};

/** Photo uploads per account: UPLOAD_RATE_PER_HOUR (default 60) and UPLOAD_RATE_PER_DAY (300). */
export const uploadWindows = (): RateWindow[] => [
  { name: "hour", windowMs: 3_600_000, max: fromEnv("UPLOAD_RATE_PER_HOUR", 60) },
  { name: "day", windowMs: 86_400_000, max: fromEnv("UPLOAD_RATE_PER_DAY", 300) },
];

/** AI requests per account: AI_RATE_PER_MINUTE (default 10) and AI_RATE_PER_DAY (default 300). */
export const aiWindows = (): RateWindow[] => [
  { name: "min", windowMs: 60_000, max: fromEnv("AI_RATE_PER_MINUTE", 10) },
  { name: "day", windowMs: 86_400_000, max: fromEnv("AI_RATE_PER_DAY", 300) },
];

/** Saving, replacing and testing AI keys and integration credentials: 20 per 10 minutes. */
export const SETTINGS_WINDOWS: RateWindow[] = [{ name: "10m", windowMs: 600_000, max: 20 }];
