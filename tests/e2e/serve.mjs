// The server for end-to-end tests (started by playwright.config.ts): makes sure the test Postgres
// runs, recreates the e2e database with all migrations, imports the FoodData Central fixture
// extracts and the seeded dishes, starts the integration mocks (Gemini, Mealie, openGym, a push
// service, Open Food Facts; tests/helpers/mock-integrations.ts) and writes their address to
// test-results/e2e-mocks.json for the tests, builds the app (unless CAL_E2E_SKIP_BUILD=1), then
// runs the worker (dist/worker.mjs) and `next start` on 127.0.0.1.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { startIntegrationMocks } from "../helpers/mock-integrations.ts";
import { ensureTestPostgres, urlForDatabase } from "../helpers/postgres.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const port = process.env.CAL_E2E_PORT || "3100";
const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl) throw new Error("E2E_DATABASE_URL is not set.");
const database = new URL(databaseUrl).pathname.slice(1);

const serverUrl = await ensureTestPostgres();
const admin = new pg.Client({ connectionString: urlForDatabase(serverUrl, "postgres") });
await admin.connect();
await admin.query(`drop database if exists "${database}" with (force)`);
await admin.query(`create database "${database}"`);
await admin.end();
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
await migrate(drizzle(pool), { migrationsFolder: path.join(root, "drizzle") });
// Real food data for matching: the FoodData Central fixture extracts and the seeded dishes.
const fixtures = path.join(root, "tests", "fixtures", "fdc");
const quiet = () => undefined;
const { run: importFdc } = await import(
  pathToFileURL(path.join(root, "scripts", "fdc-import.mjs")).href
);
const { run: seedDishes } = await import(
  pathToFileURL(path.join(root, "scripts", "seed-dishes.mjs")).href
);
await importFdc(
  pool,
  ["foundation", "sr_legacy", "fndds"].flatMap((set) => [
    "--dir",
    `${set}=${path.join(fixtures, set)}`,
  ]),
  quiet,
);
await seedDishes(pool, [], quiet);
await pool.end();

const mocks = await startIntegrationMocks();
mkdirSync(path.join(root, "test-results"), { recursive: true });
writeFileSync(
  path.join(root, "test-results", "e2e-mocks.json"),
  JSON.stringify({ url: mocks.url }),
);
// The same key maker as "cal vapid" (it keeps the private scalar at 32 bytes).
const { newVapidKeys } = await import(pathToFileURL(path.join(root, "scripts", "cal.mjs")).href);
const vapid = newVapidKeys();

const photoRoot = path.join(root, "test-results", "e2e-photos");
rmSync(photoRoot, { recursive: true, force: true });

const env = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: databaseUrl,
  CAL_SECRET_KEY: crypto.randomBytes(32).toString("base64"),
  PHOTO_ROOT: photoRoot,
  COOKIE_SECURE: "false",
  BASE_URL: `http://127.0.0.1:${port}`,
  NEXT_TELEMETRY_DISABLED: "1",
  ...mocks.env,
  INTEGRATION_TIMEOUT_MS: "5000",
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: "mailto:admin@example.org",
};

const node = process.execPath;
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

spawnSync(node, [path.join(root, "scripts", "vendor-assets.mjs")], { cwd: root, stdio: "inherit" });

if (process.env.CAL_E2E_SKIP_BUILD !== "1" || !existsSync(path.join(root, ".next", "BUILD_ID"))) {
  for (const args of [[nextBin, "build"], [path.join(root, "scripts", "build-scripts.mjs")]]) {
    const result = spawnSync(node, args, { cwd: root, env, stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

const children = [
  spawn(node, [path.join(root, "dist", "worker.mjs")], { cwd: root, env, stdio: "inherit" }),
  spawn(node, [nextBin, "start", "-H", "127.0.0.1", "-p", port], {
    cwd: root,
    env,
    stdio: "inherit",
  }),
];

const stop = () => {
  for (const child of children) if (!child.killed) child.kill();
  void mocks.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
for (const child of children) child.on("exit", (code) => code && stop());
