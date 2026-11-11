// openGym for one person (docs/DESIGN.md section 8). Pairing: the person makes a pairing code in
// openGym and pastes it into Kal within 5 minutes; Kal redeems it for a bearer token, stored
// encrypted (lib/integrations/store.ts). A sync reads GET /api/me (which hands out a fresh token
// past half of the session's lifetime; Kal keeps it) and GET /api/data, and caches the weigh-ins
// and recent workouts in the integration's settings. Kal never writes to openGym.
import { eq } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { WeightPointDto, WorkoutDto } from "@/lib/contracts/integrations";
import { isValidTimeZone, localParts } from "@/lib/meals/time";

import { integrationConfig } from "../config";
import { isIntegrationError } from "../http";
import {
  credentialOf,
  getIntegrationRow,
  removeIntegration,
  saveCredential,
  updateIntegration,
  type IntegrationRow,
} from "../store";
import { openGymClient, PAIR_CODE } from "./client";
import { metFor, parseState, weightForDay, workoutKcal, type OpenGymSnapshot } from "./parse";

/** Data older than this is read again when a screen needs it. */
export const SYNC_MAX_AGE_MS = 10 * 60_000;

const SIGNED_OUT = "openGym signed Kal out. Pair again in Settings.";

export type PairResult = { ok: true } | { ok: false; status: 400 | 422 | 502 | 503; error: string };

/** Cleans what the person pasted: "k7wq-2mzp" -> "K7WQ2MZP". */
export const cleanPairCode = (value: unknown) => {
  if (typeof value !== "string") return null;
  const code = value.toUpperCase().replace(/[\s-]/g, "");
  return PAIR_CODE.test(code) ? code : null;
};

/** Redeems a pairing code, stores the token and reads the data once. */
export const pairOpenGym = async (
  userId: string,
  rawCode: unknown,
  dbx: DbOrTx = defaultDb,
): Promise<PairResult> => {
  const config = integrationConfig();
  if (!config.opengymBaseUrl)
    return { ok: false, status: 503, error: "openGym is not set up on this server." };
  const code = cleanPairCode(rawCode);
  if (!code)
    return {
      ok: false,
      status: 400,
      error: "A pairing code has 8 letters and digits. Copy it from openGym.",
    };
  let token: string;
  try {
    token = await openGymClient(config.opengymBaseUrl, config.timeoutMs).redeem(code);
  } catch (error) {
    if (!isIntegrationError(error)) throw error;
    if (error.kind === "refused" || error.kind === "auth" || error.kind === "not_found")
      return {
        ok: false,
        status: 422,
        error:
          "This code is not valid or has expired. Make a new one in openGym and paste it within 5 minutes.",
      };
    return { ok: false, status: 502, error: error.message };
  }
  await saveCredential(userId, "opengym", token, {}, dbx);
  await audit(
    { userId, action: "integration.connect", targetType: "integration", targetId: "opengym" },
    dbx,
  );
  await syncOpenGym(userId, dbx).catch(() => undefined);
  return { ok: true };
};

export const disconnectOpenGym = async (userId: string, dbx: DbOrTx = defaultDb) => {
  const removed = await removeIntegration(userId, "opengym", dbx);
  if (removed)
    await audit(
      { userId, action: "integration.disconnect", targetType: "integration", targetId: "opengym" },
      dbx,
    );
  return removed;
};

/**
 * A failed sync says why with an HTTP status for the route: 503 openGym is not set up on this
 * server, 409 the person has not paired openGym (nothing to read yet), 502 openGym refused or did
 * not answer.
 */
export type SyncResult =
  { ok: true; snapshot: OpenGymSnapshot } | { ok: false; status: 409 | 502 | 503; error: string };

const inFlight = new Map<string, Promise<SyncResult>>();

const runSync = async (userId: string, dbx: DbOrTx): Promise<SyncResult> => {
  const config = integrationConfig();
  if (!config.opengymBaseUrl)
    return { ok: false, status: 503, error: "openGym is not set up on this server." };
  const row = await getIntegrationRow(userId, "opengym", dbx);
  let token = credentialOf(row);
  if (!token) return { ok: false, status: 409, error: "Pair openGym in Settings first." };
  const client = openGymClient(config.opengymBaseUrl, config.timeoutMs);
  try {
    const me = await client.me(token);
    if (me.token && me.token !== token) {
      token = me.token;
      await saveCredential(userId, "opengym", token, undefined, dbx);
    }
    const { state, rev } = await client.data(token);
    const snapshot = parseState(state);
    await updateIntegration(
      userId,
      "opengym",
      {
        status: "ok",
        statusMessage: null,
        lastSyncAt: new Date(),
        settings: { ...snapshot, rev },
      },
      dbx,
    );
    return { ok: true, snapshot };
  } catch (error) {
    if (!isIntegrationError(error)) throw error;
    const message = error.kind === "auth" ? SIGNED_OUT : error.message;
    await updateIntegration(userId, "opengym", { status: "error", statusMessage: message }, dbx);
    return { ok: false, status: 502, error: message };
  }
};

/** Reads weigh-ins and workouts from openGym now (one sync per person at a time). */
export const syncOpenGym = (userId: string, dbx: DbOrTx = defaultDb): Promise<SyncResult> => {
  const running = inFlight.get(userId);
  if (running) return running;
  const next = runSync(userId, dbx).finally(() => inFlight.delete(userId));
  inFlight.set(userId, next);
  return next;
};

const snapshotOf = (row: IntegrationRow | null): OpenGymSnapshot | null => {
  if (!row || !credentialOf(row)) return null;
  const settings = (row.settings ?? {}) as Partial<OpenGymSnapshot>;
  return {
    unit: settings.unit === "lb" ? "lb" : "kg",
    weights: Array.isArray(settings.weights) ? settings.weights : [],
    workouts: Array.isArray(settings.workouts) ? settings.workouts : [],
    latestWeight: settings.latestWeight ?? null,
  };
};

/**
 * The cached openGym data, read again first when older than maxAgeMs (failures keep the cache
 * and mark the integration). Null when openGym is not paired.
 */
export const openGymData = async (
  userId: string,
  options: { maxAgeMs?: number } = {},
  dbx: DbOrTx = defaultDb,
): Promise<OpenGymSnapshot | null> => {
  const row = await getIntegrationRow(userId, "opengym", dbx);
  if (!row || !credentialOf(row)) return null;
  const age = row.lastSyncAt ? Date.now() - row.lastSyncAt.getTime() : Infinity;
  if (age > (options.maxAgeMs ?? SYNC_MAX_AGE_MS) && integrationConfig().opengymBaseUrl) {
    const result = await syncOpenGym(userId, dbx).catch(() => null);
    if (result?.ok) return result.snapshot;
  }
  return snapshotOf(row);
};

const timeOfDay = (ms: number, tz: string) => localParts(new Date(ms), tz).time;

/** Workouts of one local day with their energy estimate. */
export const getWorkouts = async (
  userId: string,
  localDate: string,
  dbx: DbOrTx = defaultDb,
): Promise<WorkoutDto[]> => {
  const data = await openGymData(userId, {}, dbx);
  if (!data) return [];
  const user = (
    await dbx
      .select({ weightKg: users.weightKg, timeZone: users.timeZone })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  const tz = user && isValidTimeZone(user.timeZone) ? user.timeZone : "UTC";
  return data.workouts
    .filter((w) => w.date === localDate)
    .map((w) => {
      const kg = w.bwKg ?? weightForDay(w.date, data.weights, user?.weightKg ?? null);
      const met = metFor(`${w.name} ${w.exercises.join(" ")}`).met;
      return {
        id: w.id,
        date: w.date,
        startTime: w.start ? timeOfDay(w.start, tz) : null,
        name: w.name,
        durationMin: w.durationMin ?? 0,
        kcalEstimate: workoutKcal(met, kg, w.durationMin),
        exercises: w.exercises,
      };
    });
};

/** Weigh-ins between two local days (both included), oldest first. */
export const getWeights = async (
  userId: string,
  from: string,
  to: string,
  dbx: DbOrTx = defaultDb,
): Promise<WeightPointDto[]> => {
  const data = await openGymData(userId, {}, dbx);
  return (data?.weights ?? []).filter((w) => w.date >= from && w.date <= to);
};
