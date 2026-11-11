// Health Connect batches from the Kal Android app against Postgres: the device token, every kind
// of record and where it lands, sending again (idempotent), deletions, Health Connect's step
// totals winning over other sources, records the server leaves out, size and rate limits, the
// phone's last sync, export and "Delete my data".
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  activities,
  bodyMeasurements,
  devices,
  heartRates,
  sleepSessions,
  users,
} from "@/db/schema";
import { deleteUserData, exportUserData } from "@/lib/account/data";
import { importActivities } from "@/lib/activities/service";
import type { SessionUser } from "@/lib/auth/accounts";
import type { HcSyncResult } from "@/lib/contracts/health-connect";
import { createLinkCode, claimLinkCode, listDevices } from "@/lib/devices/service";
import { keptHealthConnect } from "@/lib/health-connect/sync";
import { localParts, shiftLocalDate } from "@/lib/meals/time";
import { getMoveDay } from "@/lib/move/service";
import { createUser } from "@/tests/helpers/factories";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => session.user }));

const syncRoute = await import("@/app/api/health-connect/sync/route");

const ORIGIN = "http://127.0.0.1:3201";
const TZ = "Europe/Berlin";
const SAMSUNG = "com.sec.android.app.shealth";
const RENPHO = "com.qingniu.renpho";

const today = () => localParts(new Date(), TZ).date;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const daysAgo = (d: number) => shiftLocalDate(today(), -d);

const linkPhone = async (userId: string) => {
  const { code } = await createLinkCode(userId);
  const result = await claimLinkCode(code, { name: "samsung SM-S928B", appVersion: "1.0 (1)" });
  if (typeof result === "string") throw new Error(result);
  return result.token;
};

const send = async (token: string, body: unknown, headers: Record<string, string> = {}) => {
  const response = await syncRoute.POST(
    new NextRequest(`${ORIGIN}/api/health-connect/sync`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    body: (await response.json()) as HcSyncResult & { error?: string },
  };
};

const runId = "6f1c1d57-0f7e-4a3c-9a55-3c2f4b6d1a01";
const weighId = "7a2d2e68-1a8f-4b4d-8b66-4d305c7e2b02";
const waterId = "8b3e3f79-2b90-4c5e-9c77-5e416d8f3c03";
const fatId = "9c4f4080-3ca1-4d6f-8d88-6f527e904d04";
const sleepId = "ad505191-4db2-4e70-9e99-70638fa15e05";

/** A batch of every kind, as the app sends it after reading Health Connect. */
const fullBatch = () => ({
  tz: TZ,
  appVersion: "1.0 (1)",
  steps: [
    { date: today(), count: 8412, sourceApp: SAMSUNG },
    { date: daysAgo(1), count: 10_250, sourceApp: SAMSUNG },
  ],
  workouts: [
    {
      id: runId,
      category: "cardio",
      type: "run",
      title: "Morning run",
      start: hoursAgo(3),
      end: hoursAgo(2.5),
      localDate: null,
      distanceM: 5200,
      energyKcal: 351.6,
      steps: 5100,
      avgHeartRate: 148.24,
      maxHeartRate: 171,
      sourceApp: SAMSUNG,
    },
  ],
  body: [
    { id: weighId, code: "weight", value: 80.24, at: hoursAgo(5), sourceApp: RENPHO },
    { id: waterId, code: "water_mass", value: 44.1, at: hoursAgo(5), sourceApp: RENPHO },
    { id: fatId, code: "body_fat", value: 21.4, at: hoursAgo(5), sourceApp: RENPHO },
  ],
  height: { cm: 181.04, at: hoursAgo(100) },
  restingHeartRate: [{ date: today(), bpm: 57.6, sourceApp: SAMSUNG }],
  sleep: [
    {
      id: sleepId,
      start: hoursAgo(14),
      end: hoursAgo(6.5),
      title: null,
      stages: { light: 230, deep: 95, rem: 100, awake: 25 },
      sourceApp: SAMSUNG,
    },
  ],
});

const rowsOf = async (userId: string) => ({
  activities: await db.select().from(activities).where(eq(activities.userId, userId)),
  body: await db.select().from(bodyMeasurements).where(eq(bodyMeasurements.userId, userId)),
  heart: await db.select().from(heartRates).where(eq(heartRates.userId, userId)),
  sleep: await db.select().from(sleepSessions).where(eq(sleepSessions.userId, userId)),
});

let ann: { id: string };
let annToken: string;

beforeAll(async () => {
  ann = await createUser({ timeZone: TZ });
  annToken = await linkPhone(ann.id);
});

beforeEach(async () => {
  delete process.env.HEALTH_CONNECT_RATE_PER_HOUR;
  await db.execute(sql`delete from rate_limits`);
});

describe("the device token", () => {
  it("answers 401 Unlinked without a token, with a wrong one and after unlinking", async () => {
    expect((await send("", fullBatch())).status).toBe(401);
    const wrong = await send(`kal_${"b".repeat(43)}`, fullBatch());
    expect(wrong).toEqual({ status: 401, body: { error: "Unlinked. Link again." } });
    const other = await createUser();
    const token = await linkPhone(other.id);
    await db.update(devices).set({ revokedAt: new Date() }).where(eq(devices.userId, other.id));
    expect((await send(token, fullBatch())).status).toBe(401);
    expect((await rowsOf(other.id)).activities).toHaveLength(0);
  });
});

describe("a batch of every kind", () => {
  it("lands in Move, Body, heart rate and sleep, and updates instead of copying", async () => {
    const first = await send(annToken, fullBatch());
    expect(first.status).toBe(200);
    // 2 step days + 1 workout, 2 heart rates, 3 body values, 1 sleep.
    expect(first.body).toEqual({ added: 9, updated: 0, removed: 0, skipped: 0 });

    const rows = await rowsOf(ann.id);
    const run = rows.activities.find((a) => a.externalId === runId)!;
    expect(run).toMatchObject({
      category: "cardio",
      type: "run",
      title: "Morning run",
      durationMin: 30,
      distanceM: 5200,
      steps: 5100,
      energyKcal: 352,
      intensity: "vigorous",
      source: "health_connect",
      sourceApp: SAMSUNG,
      tz: TZ,
    });
    const day = rows.activities.find((a) => a.externalId === `steps:${today()}`)!;
    expect(day).toMatchObject({ type: "steps", category: "walking", steps: 8412 });
    expect(day.localDate).toBe(today());
    expect(rows.heart.map((h) => [h.kind, h.bpm, h.maxBpm]).sort()).toEqual([
      ["resting", 57.6, null],
      ["workout", 148.2, 171],
    ]);
    expect(Object.fromEntries(rows.body.map((b) => [b.code, b.value]))).toEqual({
      weight: 80.24,
      // 44.1 kg of 80.24 kg
      water: 55,
      body_fat: 21.4,
    });
    expect(rows.body.every((b) => b.externalId && b.sourceApp === RENPHO)).toBe(true);
    expect(rows.sleep[0]).toMatchObject({
      durationMin: 450,
      stages: { light: 230, deep: 95, rem: 100, awake: 25 },
      localDate: localParts(new Date(hoursAgo(6.5)), TZ).date,
    });
    const profile = (await db.select().from(users).where(eq(users.id, ann.id)))[0]!;
    expect(profile.heightCm).toBe(181);

    const again = await send(annToken, fullBatch());
    expect(again.body).toEqual({ added: 0, updated: 9, removed: 0, skipped: 0 });
    const after = await rowsOf(ann.id);
    expect(after.activities).toHaveLength(3);
    expect(after.body).toHaveLength(3);
    expect(after.heart).toHaveLength(2);
    expect(after.sleep).toHaveLength(1);

    const [phone] = await listDevices(ann.id);
    expect(phone!.lastSyncAt).not.toBeNull();
    expect(phone!.sends).toEqual(["steps", "workouts", "heart_rate", "sleep", "weight", "body"]);
    expect(await keptHealthConnect(ann.id)).toEqual({
      restingDays: 1,
      workoutHeartRates: 1,
      sleepNights: 1,
    });
  });

  it("keeps the height the person typed", async () => {
    const typed = await createUser({ heightCm: 170, timeZone: TZ });
    const token = await linkPhone(typed.id);
    await send(token, { tz: TZ, height: { cm: 181, at: hoursAgo(1) } });
    const profile = (await db.select().from(users).where(eq(users.id, typed.id)))[0]!;
    expect(profile.heightCm).toBe(170);
  });

  it("leaves out records it cannot use and counts them", async () => {
    const person = await createUser({ timeZone: TZ });
    const token = await linkPhone(person.id);
    const result = await send(token, {
      tz: TZ,
      steps: [
        { date: today(), count: -5 },
        { date: "2001-01-01", count: 100 },
        { date: today(), count: 900 },
      ],
      workouts: [
        { ...fullBatch().workouts[0]!, id: "w-backwards", start: hoursAgo(1), end: hoursAgo(2) },
        { ...fullBatch().workouts[0]!, id: "w-unknown", category: "flying" },
      ],
      body: [
        // Body water without a weight that day cannot become a share.
        { id: "water-alone", code: "water_mass", value: 40, at: hoursAgo(30) },
        { id: "too-heavy", code: "weight", value: 900, at: hoursAgo(2) },
        { id: "height", code: "height", value: 180, at: hoursAgo(2) },
      ],
      restingHeartRate: [{ date: today(), bpm: 400 }],
      sleep: [{ id: "s-long", start: hoursAgo(40), end: hoursAgo(1) }],
      height: { cm: 20, at: hoursAgo(1) },
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ added: 1, updated: 0, removed: 0, skipped: 10 });
  });

  it("refuses a batch it cannot read", async () => {
    expect((await send(annToken, { tz: "Mars/Olympus" })).status).toBe(400);
    expect((await send(annToken, "not json")).status).toBe(400);
    expect((await send(annToken, { tz: TZ, steps: "many" })).status).toBe(400);
    expect((await send(annToken, { tz: TZ, deleted: ["bad id!"] })).status).toBe(400);
  });
});

describe("deletions", () => {
  it("removes records deleted in Health Connect, and empty days", async () => {
    const person = await createUser({ timeZone: TZ });
    const token = await linkPhone(person.id);
    await send(token, fullBatch());
    const result = await send(token, {
      tz: TZ,
      deleted: [runId, fatId, sleepId, "an-id-kal-never-saw"],
      steps: [{ date: daysAgo(1), count: 0 }],
      restingHeartRate: [{ date: today(), bpm: null }],
    });
    // The run and its heart rate, body fat, the sleep, a step day, a resting day.
    expect(result.body).toEqual({ added: 0, updated: 0, removed: 6, skipped: 0 });
    const rows = await rowsOf(person.id);
    expect(rows.activities.map((a) => a.externalId)).toEqual([`steps:${today()}`]);
    expect(rows.body.map((b) => b.code).sort()).toEqual(["water", "weight"]);
    expect(rows.heart).toHaveLength(0);
    expect(rows.sleep).toHaveLength(0);
  });

  it("touches only the phone owner's records", async () => {
    const one = await createUser({ timeZone: TZ });
    const two = await createUser({ timeZone: TZ });
    const oneToken = await linkPhone(one.id);
    const twoToken = await linkPhone(two.id);
    await send(oneToken, fullBatch());
    await send(twoToken, fullBatch());
    await send(oneToken, { tz: TZ, deleted: [runId, weighId] });
    expect((await rowsOf(two.id)).activities.some((a) => a.externalId === runId)).toBe(true);
    expect((await rowsOf(two.id)).body.some((b) => b.externalId === weighId)).toBe(true);
  });
});

describe("steps of a day from several sources", () => {
  it("uses Health Connect's day total over an imported count", async () => {
    const person = await createUser({ timeZone: TZ });
    const token = await linkPhone(person.id);
    await importActivities(person.id, [
      {
        externalId: `samsung:steps:${today()}`,
        sourceApp: "samsung-health",
        category: "walking",
        type: "steps",
        title: "Steps",
        startedAt: new Date().toISOString(),
        tz: TZ,
        localDate: today(),
        steps: 12_000,
      },
    ]);
    expect((await getMoveDay(person.id, today())).steps).toBe(12_000);
    await send(token, { tz: TZ, steps: [{ date: today(), count: 8412, sourceApp: SAMSUNG }] });
    const day = await getMoveDay(person.id, today());
    expect(day.steps).toBe(8412);
    expect(day.stepsSource).toBe("Samsung Health");
    await send(token, { tz: TZ, steps: [{ date: today(), count: 9100 }] });
    expect(await getMoveDay(person.id, today())).toMatchObject({
      steps: 9100,
      stepsSource: "Health Connect",
    });
  });
});

describe("limits", () => {
  it("refuses batches over the record, deletion and size limits", async () => {
    const steps = Array.from({ length: 2001 }, (_, i) => ({
      date: shiftLocalDate(today(), -(i % 300)),
      count: 1,
    }));
    expect((await send(annToken, { tz: TZ, steps })).status).toBe(413);
    const deleted = Array.from({ length: 5001 }, (_, i) => `id-${i}`);
    expect((await send(annToken, { tz: TZ, deleted })).status).toBe(413);
    const big = await send(annToken, { tz: TZ }, { "content-length": String(3 * 1024 * 1024) });
    expect(big.status).toBe(413);
  });

  it("limits batches per phone and hour", async () => {
    process.env.HEALTH_CONNECT_RATE_PER_HOUR = "3";
    const person = await createUser({ timeZone: TZ });
    const token = await linkPhone(person.id);
    for (let i = 0; i < 3; i++) expect((await send(token, { tz: TZ })).status).toBe(200);
    const limited = await send(token, { tz: TZ });
    expect(limited.status).toBe(429);
    // Another phone has its own count.
    expect((await send(annToken, { tz: TZ })).status).toBe(200);
  });
});

describe("export and Delete my data", () => {
  it("exports heart rate and sleep, and removes everything the phone sent", async () => {
    const person = await createUser({ timeZone: TZ });
    const token = await linkPhone(person.id);
    await send(token, fullBatch());
    const data = (await exportUserData(person.id))!;
    expect(data.heartRates.map((h) => h.kind).sort()).toEqual(["resting", "workout"]);
    expect(data.sleep).toEqual([
      expect.objectContaining({ durationMin: 450, sourceApp: SAMSUNG, title: null }),
    ]);
    expect(data.activities.filter((a) => a.source === "health_connect")).toHaveLength(3);
    await deleteUserData(person.id);
    const rows = await rowsOf(person.id);
    expect(Object.values(rows).every((list) => list.length === 0)).toBe(true);
    expect((await send(token, fullBatch())).status).toBe(401);
    const left = await db
      .select()
      .from(devices)
      .where(and(eq(devices.userId, person.id)));
    expect(left).toHaveLength(0);
  });
});
