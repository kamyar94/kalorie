// Runs before each integration test file: a fresh database copied from the migrated template,
// used through DATABASE_URL by db/index.ts, dropped after the file.
import crypto from "node:crypto";

import pg from "pg";
import { afterAll, inject } from "vitest";

import { closeDb } from "@/db";

import { urlForDatabase } from "./postgres";

const serverUrl = inject("pgServerUrl");
const template = inject("pgTemplate");
const database = `cal_test_${process.pid}_${crypto.randomBytes(4).toString("hex")}`;

const admin = new pg.Client({ connectionString: serverUrl });
await admin.connect();
await admin.query(`create database "${database}" template "${template}"`);

process.env.DATABASE_URL = urlForDatabase(serverUrl, database);
process.env.CAL_SECRET_KEY ??= crypto.randomBytes(32).toString("base64");

afterAll(async () => {
  await closeDb();
  await admin.query(`drop database if exists "${database}" with (force)`);
  await admin.end();
});
