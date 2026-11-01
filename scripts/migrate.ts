// Development: applies the migrations in ./drizzle to DATABASE_URL (pnpm db:migrate).
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || undefined, max: 1 });
await migrate(drizzle(pool), { migrationsFolder: path.resolve("drizzle") });
await pool.end();
console.log("Database schema is up to date.");
