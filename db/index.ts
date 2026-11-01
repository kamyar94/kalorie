// The database client. Connection settings come from DATABASE_URL, or from the standard PG*
// variables when it is not set. The pool is made on first use and kept on globalThis so the
// development server's reloads do not open new pools.
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
/** A transaction handle; every helper that writes accepts Db or Tx. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

type State = { pool: pg.Pool; db: Db };
const store = globalThis as unknown as { __calDb?: State };

const state = (): State => {
  if (!store.__calDb) {
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL || undefined,
      max: Number(process.env.DATABASE_POOL_MAX) || 10,
    });
    // An idle client that loses its connection must not crash the process.
    pool.on("error", (error) => console.error("Database pool error:", error.message));
    store.__calDb = { pool, db: drizzle(pool, { schema }) };
  }
  return store.__calDb;
};

export const getPool = () => state().pool;
export const getDb = () => state().db;

/** The shared Drizzle instance, made on first use. */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real) as unknown;
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});

/** Closes the pool (worker shutdown, tests). The next use opens a new one. */
export const closeDb = async () => {
  const current = store.__calDb;
  store.__calDb = undefined;
  await current?.pool.end();
};

export { schema };
