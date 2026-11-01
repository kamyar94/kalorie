// The job queue in Postgres. Jobs are rows in `jobs`; a worker claims the oldest due job with
// FOR UPDATE SKIP LOCKED, so several workers never take the same job. enqueue sends a NOTIFY on
// the "cal_jobs" channel, delivered when the surrounding transaction commits, which wakes idle
// workers at once. A failed job goes back to the queue with exponential backoff (run_after) until
// it runs out of attempts.
//
// Enqueue inside the same transaction that writes the data the job needs (for example the meal and
// its photos), so a job never points at rows that were rolled back.
import { sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";

export const JOBS_CHANNEL = "cal_jobs";

export type JobStatus = "queued" | "running" | "done" | "failed";

export type Job = {
  id: number;
  kind: string;
  payload: unknown;
  userId: string | null;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  dedupeKey: string | null;
  lockedBy: string | null;
  lastError: string | null;
  result: unknown;
};

type JobRow = {
  id: string | number;
  kind: string;
  payload: unknown;
  user_id: string | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_after: Date | string;
  dedupe_key: string | null;
  locked_by: string | null;
  last_error: string | null;
  result: unknown;
};

const toJob = (row: JobRow): Job => ({
  id: Number(row.id),
  kind: row.kind,
  payload: row.payload,
  userId: row.user_id,
  status: row.status,
  attempts: Number(row.attempts),
  maxAttempts: Number(row.max_attempts),
  runAfter: new Date(row.run_after),
  dedupeKey: row.dedupe_key,
  lockedBy: row.locked_by,
  lastError: row.last_error,
  result: row.result,
});

export type EnqueueOptions = {
  userId?: string | null;
  /** Do not run before this time. Default: now. */
  runAfter?: Date;
  /** Default 5. */
  maxAttempts?: number;
  /**
   * At most one queued job per kind and key: while one is waiting, enqueueing the same key
   * returns the waiting job instead of adding another (it reads the latest data when it runs).
   */
  dedupeKey?: string;
};

/** Adds a job and wakes the workers. Returns the job id (an existing one when deduplicated). */
export const enqueueJob = async (
  kind: string,
  payload: unknown,
  options: EnqueueOptions = {},
  dbx: DbOrTx = defaultDb,
): Promise<{ id: number; created: boolean }> => {
  const runAfter = options.runAfter ?? null;
  const inserted = await dbx.execute<{ id: string }>(sql`
    insert into jobs (kind, payload, user_id, max_attempts, run_after, dedupe_key)
    values (${kind}, ${JSON.stringify(payload ?? {})}::jsonb, ${options.userId ?? null},
            ${options.maxAttempts ?? 5}, coalesce(${runAfter}::timestamptz, now()),
            ${options.dedupeKey ?? null})
    on conflict (kind, dedupe_key) where dedupe_key is not null and status = 'queued'
    do nothing
    returning id`);
  let id = inserted.rows[0]?.id;
  const created = id !== undefined;
  if (!created) {
    const existing = await dbx.execute<{ id: string }>(sql`
      select id from jobs
       where kind = ${kind} and dedupe_key = ${options.dedupeKey ?? null} and status = 'queued'
       limit 1`);
    id = existing.rows[0]?.id;
    if (id === undefined) throw new Error("The job could not be queued.");
  }
  await dbx.execute(sql`select pg_notify(${JOBS_CHANNEL}, ${kind})`);
  return { id: Number(id), created };
};

/** Claims the oldest due job of the given kinds, or returns null when none is due. */
export const claimJob = async (
  workerId: string,
  kinds: string[],
  dbx: DbOrTx = defaultDb,
): Promise<Job | null> => {
  if (!kinds.length) return null;
  const result = await dbx.execute<JobRow>(sql`
    update jobs set status = 'running', locked_at = now(), locked_by = ${workerId},
                    attempts = attempts + 1, updated_at = now()
     where id = (
       select id from jobs
        where status = 'queued' and run_after <= now()
          and kind = any(${sql.param(kinds)}::text[])
        order by run_after, id
        for update skip locked
        limit 1)
    returning *`);
  const row = result.rows[0];
  return row ? toJob(row) : null;
};

export const completeJob = async (id: number, result: unknown, dbx: DbOrTx = defaultDb) => {
  await dbx.execute(sql`
    update jobs set status = 'done', result = ${JSON.stringify(result ?? null)}::jsonb,
                    locked_at = null, finished_at = now(), updated_at = now(), last_error = null
     where id = ${id}`);
};

/** Delay before the next try: 15 s, 30 s, 1 min ... up to 30 min, with a little jitter. */
export const backoffMs = (attempts: number, random: () => number = Math.random) => {
  const base = Math.min(30 * 60_000, 15_000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.9 + 0.2 * random()));
};

/**
 * Records a failure. The job goes back to the queue after a backoff when it may be retried and
 * has attempts left; otherwise it is marked failed. Returns the new status.
 */
export const failJob = async (
  job: Pick<Job, "id" | "attempts" | "maxAttempts">,
  error: { message: string; retry: boolean; retryAfterMs?: number },
  dbx: DbOrTx = defaultDb,
): Promise<"queued" | "failed"> => {
  const message = error.message.slice(0, 1000);
  if (error.retry && job.attempts < job.maxAttempts) {
    const delay = Math.max(error.retryAfterMs ?? 0, backoffMs(job.attempts));
    await dbx.execute(sql`
      update jobs set status = 'queued', locked_at = null, locked_by = null,
                      run_after = now() + ${delay}::double precision * interval '1 millisecond',
                      last_error = ${message}, updated_at = now()
       where id = ${job.id}`);
    return "queued";
  }
  await dbx.execute(sql`
    update jobs set status = 'failed', locked_at = null, last_error = ${message},
                    finished_at = now(), updated_at = now()
     where id = ${job.id}`);
  return "failed";
};

/**
 * Returns jobs whose worker vanished (running longer than staleMs) to the queue, or fails them
 * when they have no attempts left. Returns how many were recovered.
 */
export const recoverStaleJobs = async (staleMs: number, dbx: DbOrTx = defaultDb) => {
  const result = await dbx.execute<{ id: string }>(sql`
    update jobs set
      status = case when attempts >= max_attempts then 'failed' else 'queued' end,
      finished_at = case when attempts >= max_attempts then now() else null end,
      last_error = coalesce(last_error, 'The worker stopped while running this job.'),
      locked_at = null, locked_by = null, updated_at = now()
     where status = 'running' and locked_at < now() - ${staleMs}::double precision * interval '1 millisecond'
    returning id`);
  return result.rows.length;
};

export const getJob = async (id: number, dbx: DbOrTx = defaultDb) => {
  const result = await dbx.execute<JobRow>(sql`select * from jobs where id = ${id}`);
  const row = result.rows[0];
  return row ? toJob(row) : null;
};

/** Finished jobs older than the given number of days are deleted (called by the worker). */
export const pruneFinishedJobs = async (days = 14, dbx: DbOrTx = defaultDb) => {
  await dbx.execute(sql`
    delete from jobs where status in ('done', 'failed') and finished_at < now() - make_interval(days => ${days})`);
};
