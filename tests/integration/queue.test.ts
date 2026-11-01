// The Postgres job queue: concurrent claims, retries with backoff, permanent failures,
// deduplication, stale recovery, and the worker woken by NOTIFY.
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  claimJob,
  completeJob,
  enqueueJob,
  failJob,
  getJob,
  recoverStaleJobs,
} from "@/lib/queue/queue";
import { drainJobs, JobError, runJob, startWorker, type HandlerRegistry } from "@/lib/queue/worker";

beforeEach(async () => {
  await db.execute(sql`delete from jobs`);
});

const waitFor = async (check: () => Promise<boolean>, timeoutMs = 5000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out");
};

describe("job queue", () => {
  it("hands every job to exactly one of many concurrent workers", async () => {
    for (let i = 0; i < 30; i++) await enqueueJob("test", { i });
    const claimed: number[] = [];
    await Promise.all(
      Array.from({ length: 6 }, async (_, w) => {
        for (;;) {
          const job = await claimJob(`w${w}`, ["test"]);
          if (!job) return;
          claimed.push((job.payload as { i: number }).i);
          await completeJob(job.id, { ok: true });
        }
      }),
    );
    expect(claimed.sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i));
    const left = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from jobs where status <> 'done'`,
    );
    expect(left.rows[0]!.n).toBe(0);
  });

  it("claims only due jobs of the asked kinds, oldest first", async () => {
    const later = await enqueueJob("test", { n: 1 }, { runAfter: new Date(Date.now() + 60_000) });
    const other = await enqueueJob("other", { n: 2 });
    const now = await enqueueJob("test", { n: 3 });
    const job = await claimJob("w", ["test"]);
    expect(job?.id).toBe(now.id);
    expect(job?.attempts).toBe(1);
    expect(await claimJob("w", ["test"])).toBeNull();
    expect((await getJob(later.id))?.status).toBe("queued");
    expect((await getJob(other.id))?.status).toBe("queued");
  });

  it("retries failures with growing delays, then gives up", async () => {
    const { id } = await enqueueJob("test", {}, { maxAttempts: 2 });
    const first = (await claimJob("w", ["test"]))!;
    expect(await failJob(first, { message: "boom", retry: true })).toBe("queued");
    const after = (await getJob(id))!;
    expect(after.lastError).toBe("boom");
    expect(after.runAfter.getTime() - Date.now()).toBeGreaterThan(10_000);
    expect(await claimJob("w", ["test"])).toBeNull();

    await db.execute(sql`update jobs set run_after = now() where id = ${id}`);
    const second = (await claimJob("w", ["test"]))!;
    expect(second.attempts).toBe(2);
    expect(await failJob(second, { message: "boom again", retry: true })).toBe("failed");
    expect((await getJob(id))?.status).toBe("failed");
  });

  it("runs handlers: results stored, JobError without retry fails at once, unknown kinds fail", async () => {
    const handlers: HandlerRegistry = {
      ok: async (payload) => ({ echo: payload }),
      fatal: async () => {
        throw new JobError("not food", { retry: false });
      },
      flaky: async () => {
        throw new Error("provider busy");
      },
    };
    const ok = await enqueueJob("ok", { a: 1 });
    const fatal = await enqueueJob("fatal", {});
    const flaky = await enqueueJob("flaky", {});
    expect(await drainJobs(handlers)).toBe(3);
    expect(await getJob(ok.id)).toMatchObject({ status: "done", result: { echo: { a: 1 } } });
    expect(await getJob(fatal.id)).toMatchObject({ status: "failed", lastError: "not food" });
    expect(await getJob(flaky.id)).toMatchObject({ status: "queued", lastError: "provider busy" });

    const stray = await enqueueJob("unknown", {});
    const job = (await claimJob("w", ["unknown"]))!;
    expect(await runJob(job, handlers)).toBe("failed");
    expect((await getJob(stray.id))?.lastError).toMatch(/No handler/);
  });

  it("keeps one queued job per dedupe key", async () => {
    const a = await enqueueJob("analyze", { v: 1 }, { dedupeKey: "meal:1" });
    const b = await enqueueJob("analyze", { v: 2 }, { dedupeKey: "meal:1" });
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    // While the first runs, a new request may queue behind it.
    await claimJob("w", ["analyze"]);
    const c = await enqueueJob("analyze", { v: 3 }, { dedupeKey: "meal:1" });
    expect(c.created).toBe(true);
  });

  it("enqueues inside a transaction only when it commits", async () => {
    await expect(
      db.transaction(async (tx) => {
        await enqueueJob("test", {}, {}, tx);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await claimJob("w", ["test"])).toBeNull();
  });

  it("returns jobs of a vanished worker to the queue", async () => {
    const { id } = await enqueueJob("test", {});
    await claimJob("w", ["test"]);
    await db.execute(sql`update jobs set locked_at = now() - interval '1 hour' where id = ${id}`);
    expect(await recoverStaleJobs(60_000)).toBe(1);
    expect((await getJob(id))?.status).toBe("queued");
  });
});

describe("worker", () => {
  it("wakes on NOTIFY and runs new jobs without waiting for the poll", async () => {
    const seen: unknown[] = [];
    const worker = startWorker({
      handlers: { ping: async (payload) => void seen.push(payload) },
      pollMs: 60_000,
      log: () => undefined,
    });
    try {
      // Give the listener a moment to connect, then enqueue from "another process".
      await new Promise((resolve) => setTimeout(resolve, 300));
      const { id } = await enqueueJob("ping", { hello: "world" });
      await waitFor(async () => (await getJob(id))?.status === "done", 4000);
      expect(seen).toEqual([{ hello: "world" }]);
    } finally {
      await worker.stop();
    }
  });

  it("runs several jobs at once up to its concurrency", async () => {
    let running = 0;
    let peak = 0;
    const worker = startWorker({
      handlers: {
        slow: async () => {
          running++;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 150));
          running--;
        },
      },
      concurrency: 3,
      pollMs: 50,
      listen: false,
      log: () => undefined,
    });
    try {
      for (let i = 0; i < 6; i++) await enqueueJob("slow", {});
      worker.wake();
      await waitFor(async () => {
        const r = await db.execute<{ n: number }>(
          sql`select count(*)::int as n from jobs where status = 'done'`,
        );
        return r.rows[0]!.n === 6;
      });
      expect(peak).toBe(3);
    } finally {
      await worker.stop();
    }
  });
});
