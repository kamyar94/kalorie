// Container start (adapted from the Lingo project): waits for Postgres, applies the migrations in
// ./drizzle, removes expired sign-ins, then starts the Next.js server. Bundled into dist/start.mjs
// by scripts/build-scripts.mjs; in the image it runs from the app folder next to server.js.
//
//   node dist/start.mjs                 migrate, then start the web server
//   node dist/start.mjs --migrate-only  migrate and exit (tests, one-off upgrades)
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = process.env.CAL_APP_DIR ?? path.resolve(here, "..");
const migrationsFolder = process.env.CAL_MIGRATIONS_DIR ?? path.join(appDir, "drizzle");
const migrateOnly = process.argv.includes("--migrate-only");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || undefined, max: 2 });

for (let attempt = 1; ; attempt++) {
  try {
    await pool.query("select 1");
    break;
  } catch (error) {
    if (attempt >= 30) throw error;
    console.log(`Waiting for the database (${error.code ?? error.message})...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

await migrate(drizzle(pool), { migrationsFolder });
console.log("Database schema is up to date.");

const pruned = await pool.query("delete from sessions where expires_at < now()");
if (pruned.rowCount) console.log(`Removed ${pruned.rowCount} expired sign-ins.`);
await pool.end();

if (!migrateOnly)
  await import(pathToFileURL(path.join(appDir, process.env.CAL_SERVER_ENTRY ?? "server.js")).href);
