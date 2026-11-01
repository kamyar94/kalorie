// The worker loop: claims due jobs, runs the registered handler for each, and records the result.
// It sleeps until a NOTIFY on "cal_jobs" arrives or the poll interval passes (delayed retries and
// a missed notification are picked up by the poll). Runs in its own process (worker/index.ts),
// from the same code base as the app.
import crypto from "node:crypto";
import os from "node:os";

import pg from "pg";

import { pruneRateLimits } from "@/lib/rate-limit";

import {
  claimJob,
  completeJob,
  failJob,
  JOBS_CHANNEL,
  pruneFinishedJobs,
  recoverStaleJobs,
  type Job,
} from "./queue";

export type JobContext = {
  id: number;
  kind: string;
  /** 1 for the first try. */
  attempt: number;
  maxAttempts: number;
  userId: string | null;
  /** Aborted when the job runs past its time limit or the worker stops. */
  signal: AbortSignal;
  log: (message: string) => void;
};

/** A job handler gets the stored payload (validate it) and returns a JSON-safe result. */
export type JobHandler = (payload: unknown, context: JobContext) => Promise<unknown>;

export type HandlerRegistry = Record<string, JobHandler>;

/**
 * Throw from a handler to control retries: retry false ends the job at once (a photo that is not
 * food, a missing key); retryAfterMs asks for a minimum wait (a provider's Retry-After).
 */
export class JobError extends Error {
  readonly retry: boolean;
  readonly retryAfterMs?: number;
  constructor(message: string, options: { retry?: boolean; retryAfterMs?: number } = {}) {
    super(message);
    this.name = "JobError";
    this.retry = options.retry ?? true;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export type WorkerOptions = {
  handlers: HandlerRegistry;
  /** Jobs run at the same time. Default WORKER_CONCURRENCY or 2. */
  concurrency?: number;
  /** Longest sleep between checks for due jobs. Default 5 s. */
  pollMs?: number;
  /** Time limit of one job; its signal aborts then. Default JOB_TIMEOUT_MS or 5 min. */
  jobTimeoutMs?: number;
  /** A running job whose worker has been silent this long goes back to the queue. Default 15 min. */
  staleMs?: number;
  /** Set false in tests to skip LISTEN and rely on polling only. */
  listen?: boolean;
  log?: (message: string) => void;
};

export type WorkerHandle = {
  id: string;
  /** Wakes the loop now (tests, or after enqueueing from the same process). */
  wake: () => void;
  /** Stops claiming, waits for running jobs, closes the LISTEN connection. */
  stop: () => Promise<void>;
};

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const describe = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";

/**
 * Runs one claimed job with its handler and records the outcome. Exported for tests and for a
 * one-shot drain; the loop in startWorker uses it too.
 */
export const runJob = async (
  job: Job,
  handlers: HandlerRegistry,
  options: { timeoutMs?: number; signal?: AbortSignal; log?: (message: string) => void } = {},
) => {
  const log = options.log ?? (() => undefined);
  const handler = handlers[job.kind];
  if (!handler) {
    await failJob(job, { message: `No handler for job kind "${job.kind}".`, retry: false });
    return "failed" as const;
  }
  const timeout = AbortSignal.timeout(
    options.timeoutMs ?? num(process.env.JOB_TIMEOUT_MS, 300_000),
  );
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const result = await handler(job.payload, {
      id: job.id,
      kind: job.kind,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
      userId: job.userId,
      signal,
      log: (message) => log(`job ${job.id} ${job.kind}: ${message}`),
    });
    await completeJob(job.id, result ?? null);
    return "done" as const;
  } catch (error) {
    const retry = error instanceof JobError ? error.retry : true;
    const retryAfterMs = error instanceof JobError ? error.retryAfterMs : undefined;
    const status = await failJob(job, { message: describe(error), retry, retryAfterMs });
    log(
      `job ${job.id} ${job.kind} ${status === "queued" ? "will retry" : "failed"}: ${describe(error)}`,
    );
    return status;
  }
};

/** Claims and runs due jobs one after another until none is due. Returns how many ran. */
export const drainJobs = async (handlers: HandlerRegistry, workerId = "drain") => {
  let count = 0;
  for (;;) {
    const job = await claimJob(workerId, Object.keys(handlers));
    if (!job) return count;
    await runJob(job, handlers);
    count += 1;
  }
};

export const startWorker = (options: WorkerOptions): WorkerHandle => {
  const id = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString("hex")}`;
  const log = options.log ?? ((message: string) => console.log(message));
  const kinds = Object.keys(options.handlers);
  const concurrency = options.concurrency ?? num(process.env.WORKER_CONCURRENCY, 2);
  const pollMs = options.pollMs ?? 5000;
  const staleMs = options.staleMs ?? 15 * 60_000;
  const stopController = new AbortController();
  const running = new Set<Promise<unknown>>();

  let wakeUp: (() => void) | null = null;
  const wake = () => {
    wakeUp?.();
    wakeUp = null;
  };
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wakeUp = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  // LISTEN on a dedicated connection; reconnects after errors.
  let listener: pg.Client | null = null;
  const connectListener = async () => {
    if (options.listen === false || stopController.signal.aborted) return;
    // Same settings as the pool: DATABASE_URL, or the standard PG* variables.
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL || undefined });
    client.on("notification", () => wake());
    client.on("error", (error) => {
      log(`Job listener lost its connection (${error.message}); reconnecting.`);
      listener = null;
      void client.end().catch(() => undefined);
      setTimeout(() => void connectListener().catch(() => undefined), 2000);
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${JOBS_CHANNEL}`);
      listener = client;
    } catch (error) {
      log(`Job listener could not connect (${describe(error)}); polling meanwhile.`);
      void client.end().catch(() => undefined);
      setTimeout(() => void connectListener().catch(() => undefined), 5000);
    }
  };

  let lastHousekeeping = 0;
  const housekeeping = async () => {
    if (Date.now() - lastHousekeeping < 60_000) return;
    lastHousekeeping = Date.now();
    const recovered = await recoverStaleJobs(staleMs);
    if (recovered) log(`Returned ${recovered} stale job(s) to the queue.`);
    await pruneRateLimits();
    await pruneFinishedJobs();
  };

  const loop = async () => {
    await connectListener();
    while (!stopController.signal.aborted) {
      try {
        await housekeeping();
        while (running.size < concurrency && !stopController.signal.aborted) {
          const job = await claimJob(id, kinds);
          if (!job) break;
          const task = runJob(job, options.handlers, {
            timeoutMs: options.jobTimeoutMs,
            signal: stopController.signal,
            log,
          })
            .catch((error) => log(`Job ${job.id} could not be recorded: ${describe(error)}`))
            .finally(() => {
              running.delete(task);
              wake();
            });
          running.add(task);
        }
      } catch (error) {
        log(`Worker loop error: ${describe(error)}`);
      }
      if (!stopController.signal.aborted) await sleep(pollMs);
    }
  };

  const done = loop();
  log(`Worker ${id} started for: ${kinds.join(", ") || "(no job kinds)"}.`);

  return {
    id,
    wake,
    stop: async () => {
      stopController.abort();
      wake();
      await done;
      await Promise.allSettled([...running]);
      await listener?.end().catch(() => undefined);
      listener = null;
    },
  };
};
