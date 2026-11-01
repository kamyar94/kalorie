// The worker process: same code base and image as the app, started with a different command
// (`pnpm worker` in development; `node dist/worker.mjs` in the container, see
// scripts/build-scripts.mjs). It runs background jobs from the Postgres queue until it gets
// SIGTERM or SIGINT, then finishes the jobs in hand and exits.
import { writeFileSync } from "node:fs";

import { closeDb } from "@/db";
import { startWorker } from "@/lib/queue/worker";

import { installWorkerHooks, jobHandlers } from "./handlers";

installWorkerHooks();
const worker = startWorker({ handlers: jobHandlers });

// Container health check: with WORKER_HEARTBEAT_FILE set, the file is touched every 15 seconds, so a
// stuck event loop shows as an old file (deploy/docker-compose.yml reads it).
const heartbeatFile = process.env.WORKER_HEARTBEAT_FILE;
if (heartbeatFile) {
  const beat = () => {
    try {
      writeFileSync(heartbeatFile, String(Date.now()));
    } catch (error) {
      console.error("Worker heartbeat failed:", error instanceof Error ? error.message : error);
    }
  };
  beat();
  setInterval(beat, 15_000).unref();
}

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`Worker received ${signal}; finishing the jobs in hand.`);
  await worker.stop();
  await closeDb();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
