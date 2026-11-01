// A throwaway Postgres for integration and end-to-end tests.
//
// CAL_TEST_DATABASE_URL set: that server is used as it is (it must allow creating databases).
// Otherwise a Docker container is started, or reused when it already runs:
//   name  CAL_TEST_PG_CONTAINER  (default cal-test-postgres)
//   port  CAL_TEST_PG_PORT       (default 55432), bound to 127.0.0.1 only
// The container keeps its data in tmpfs, so removing it leaves nothing behind:
//   docker rm -f <name>
// Each build agent or worktree sets its own name and port in .env.test.local (git-ignored).
import { execFileSync } from "node:child_process";

import pg from "pg";

export const PG_IMAGE = process.env.CAL_TEST_PG_IMAGE ?? "postgres:18.6-alpine3.24";
const PASSWORD = "cal-test-only";

export const containerName = () => process.env.CAL_TEST_PG_CONTAINER || "cal-test-postgres";
export const containerPort = () => Number(process.env.CAL_TEST_PG_PORT || 55432);

const docker = (args: string[]) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const containerState = (name: string) => {
  try {
    return docker(["inspect", "-f", "{{.State.Running}}", name]);
  } catch {
    return null;
  }
};

const waitForServer = async (url: string, timeoutMs = 60_000) => {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      await client.query("select 1");
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Postgres did not start in time: ${String(lastError)}`);
};

/** Starts (or finds) the test server and returns a URL to its "postgres" database. */
export const ensureTestPostgres = async () => {
  if (process.env.CAL_TEST_DATABASE_URL) {
    await waitForServer(process.env.CAL_TEST_DATABASE_URL);
    return process.env.CAL_TEST_DATABASE_URL;
  }
  const name = containerName();
  const port = containerPort();
  const url = `postgres://postgres:${PASSWORD}@127.0.0.1:${port}/postgres`;
  const state = containerState(name);
  if (state === "false") docker(["start", name]);
  if (state === null)
    docker([
      "run",
      "-d",
      "--name",
      name,
      "--label",
      "cal.purpose=test-database",
      "-e",
      `POSTGRES_PASSWORD=${PASSWORD}`,
      "-p",
      `127.0.0.1:${port}:5432`,
      "--tmpfs",
      "/var/lib/postgresql:rw",
      "--shm-size",
      "256m",
      PG_IMAGE,
      "-c",
      "fsync=off",
      "-c",
      "synchronous_commit=off",
      "-c",
      "full_page_writes=off",
      "-c",
      "max_connections=300",
    ]);
  await waitForServer(url);
  return url;
};

/** The same server URL with another database name. */
export const urlForDatabase = (serverUrl: string, database: string) => {
  const url = new URL(serverUrl);
  url.pathname = `/${database}`;
  return url.toString();
};
