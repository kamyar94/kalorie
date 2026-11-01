// Vitest global setup of the integration project: makes sure the test Postgres runs and builds a
// template database with all migrations applied. Each test file then gets its own copy of the
// template (tests/helpers/db-setup.ts), so files run in parallel without sharing rows.
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import type { TestProject } from "vitest/node";

import { ensureTestPostgres, urlForDatabase } from "./postgres";

declare module "vitest" {
  export interface ProvidedContext {
    pgServerUrl: string;
    pgTemplate: string;
  }
}

export const TEMPLATE_DB = `cal_template_${process.pid}`;

export default async function setup(project: TestProject) {
  const serverUrl = await ensureTestPostgres();
  const admin = new pg.Client({ connectionString: serverUrl });
  await admin.connect();
  await admin.query(`drop database if exists "${TEMPLATE_DB}" with (force)`);
  await admin.query(`create database "${TEMPLATE_DB}"`);
  const pool = new pg.Pool({ connectionString: urlForDatabase(serverUrl, TEMPLATE_DB), max: 1 });
  await migrate(drizzle(pool), {
    migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle"),
  });
  await pool.end();
  project.provide("pgServerUrl", serverUrl);
  project.provide("pgTemplate", TEMPLATE_DB);

  return async () => {
    await admin.query(`drop database if exists "${TEMPLATE_DB}" with (force)`);
    await admin.end();
  };
}
