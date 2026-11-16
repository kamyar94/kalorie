// The phones' update log against Postgres: one row per accepted batch with counts of what it held
// and what was stored, the empty flag, a read of the whole window that found nothing, batches
// the server refused (no row), 30-day pruning, the latest updates per phone, owner-only reads,
// unlinking, export and Delete my data; and the rule behind "Nothing has arrived yet" (a Health
// Connect record of the person stored in any of the four tables).
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  activities,
  bodyMeasurements,
  healthConnectUpdates,
  heartRates,
  sleepSessions,
} from "@/db/schema";
import { deleteUserData, exportUserData } from "@/lib/account/data";
import type { HcSyncResult } from "@/lib/contracts/health-connect";
import { claimLinkCode, createLinkCode, revokeDevice } from "@/lib/devices/service";
import { allUpdates, hasHealthConnectRecords, listUpdates } from "@/lib/health-connect/log";
import { localParts, shiftLocalDate } from "@/lib/meals/time";
import { createUser } from "@/tests/helpers/factories";

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => null }));

const syncRoute = await import("@/app/api/health-connect/sync/route");

const ORIGIN = "http://127.0.0.1:3201";
const TZ = "America/New_York";
const SAMSUNG = "com.sec.android.app.shealth";

const today = () => localParts(new Date(), TZ).date;
const daysAgo = (d: number) => shiftLocalDate(today(), -d);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const linkPhone = async (userId: string) => {
  const { code } = await createLinkCode(userId);
  const result = await claimLinkCode(code, { name: "Pixel 7", appVersion: "1.1 (2)" });
  if (typeof result === "string") throw new Error(result);
  return { token: result.token, deviceId: result.device.id };
};

const send = async (token: string, body: unknown) => {
  const response = await syncRoute.POST(
    new NextRequest(`${ORIGIN}/api/health-connect/sync`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as HcSyncResult };
};

const logOf = (userId: string) =>
  db.select().from(healthConnectUpdates).where(eq(healthConnectUpdates.userId, userId));

const runId = "0d6b7c41-5d0e-4f3a-8b0c-2f51a9e7c101";
const weighId = "1e7c8d52-6e1f-4a4b-9c1d-3a62b0f8d202";
const fatId = "2f8d9e63-7f20-4b5c-8d2e-4b73c1a9e303";
const sleepId = "3a9eaf74-8031-4c6d-9e3f-5c84d2b0f404";

/** What app 1.0 sends on every later read while Health Connect has nothing: zero days. */
const zeroBatch = () => ({
  tz: TZ,
  appVersion: "1.0 (1)",
  steps: [
    { date: daysAgo(1), count: 0 },
    { date: today(), count: 0 },
  ],
  restingHeartRate: [
    { date: daysAgo(1), bpm: null },
    { date: today(), bpm: null },
  ],
});

const fullBatch = () => ({
  tz: TZ,
  appVersion: "1.1 (2)",
  steps: [
    { date: daysAgo(1), count: 10_250, sourceApp: SAMSUNG },
    { date: today(), count: 6812, sourceApp: SAMSUNG },
  ],
  workouts: [
    {
      id: runId,
      category: "cardio",
      type: "run",
      title: "Morning run",
      start: hoursAgo(3),
      end: hoursAgo(2.5),
      energyKcal: 351.6,
      avgHeartRate: 148,
      sourceApp: SAMSUNG,
    },
  ],
  body: [
    { id: weighId, code: "weight", value: 80.24, at: hoursAgo(5) },
    { id: fatId, code: "body_fat", value: 21.4, at: hoursAgo(5) },
  ],
  restingHeartRate: [{ date: today(), bpm: 57.6, sourceApp: SAMSUNG }],
  sleep: [{ id: sleepId, start: hoursAgo(14), end: hoursAgo(6.5), sourceApp: SAMSUNG }],
});

beforeEach(async () => {
  delete process.env.HEALTH_CONNECT_RATE_PER_HOUR;
  await db.execute(sql`delete from rate_limits`);
});

describe("a row per update", () => {
  it("counts what each batch held and what was stored, and marks the empty ones", async () => {
    const person = await createUser({ timeZone: TZ });
    const { token, deviceId } = await linkPhone(person.id);

    expect((await send(token, zeroBatch())).status).toBe(200);
    expect((await send(token, fullBatch())).status).toBe(200);
    expect((await send(token, fullBatch())).status).toBe(200);
    expect((await send(token, { tz: TZ, deleted: [runId] })).status).toBe(200);

    const rows = (await allUpdates(person.id)).map(({ id: _id, receivedAt: _at, ...rest }) => rest);
    expect(rows).toEqual([
      {
        deviceId,
        tz: TZ,
        appVersion: "1.0 (1)",
        firstReadDays: null,
        stepDays: 0,
        stepDaysZero: 2,
        stepsToday: null,
        workouts: 0,
        restingDays: 0,
        sleepSessions: 0,
        bodyRecords: 0,
        weighIns: 0,
        height: false,
        deleted: 0,
        skipped: 0,
        added: 0,
        written: 0,
        removed: 0,
        empty: true,
      },
      {
        deviceId,
        tz: TZ,
        appVersion: "1.1 (2)",
        firstReadDays: null,
        stepDays: 2,
        stepDaysZero: 0,
        stepsToday: 6812,
        workouts: 1,
        restingDays: 1,
        sleepSessions: 1,
        bodyRecords: 2,
        weighIns: 1,
        height: false,
        deleted: 0,
        skipped: 0,
        // 2 step days and the run, 2 heart rates, 2 body values, 1 sleep.
        added: 8,
        written: 8,
        removed: 0,
        empty: false,
      },
      expect.objectContaining({ stepsToday: 6812, added: 0, written: 8, empty: false }),
      expect.objectContaining({
        appVersion: null,
        deleted: 1,
        // The run and its heart rate.
        removed: 2,
        empty: true,
      }),
    ]);
  });

  it("notes a read of the whole window that found Health Connect empty", async () => {
    const person = await createUser({ timeZone: TZ });
    const { token } = await linkPhone(person.id);
    const result = await send(token, { tz: TZ, appVersion: "1.1 (2)", firstReadDays: 30 });
    expect(result).toEqual({
      status: 200,
      body: { added: 0, updated: 0, removed: 0, skipped: 0 },
    });
    const [row] = await logOf(person.id);
    expect(row).toMatchObject({ firstReadDays: 30, empty: true, stepDays: 0, written: 0 });
    // An odd value is read as "not said", the batch still counts.
    await send(token, { tz: TZ, firstReadDays: "thirty" });
    await send(token, { tz: TZ, firstReadDays: 0 });
    expect((await logOf(person.id)).map((r) => r.firstReadDays).sort()).toEqual([30, null, null]);
  });

  it("writes nothing for a batch the server refused", async () => {
    process.env.HEALTH_CONNECT_RATE_PER_HOUR = "3";
    const person = await createUser({ timeZone: TZ });
    const { token, deviceId } = await linkPhone(person.id);
    expect((await send(token, { tz: "Mars/Olympus" })).status).toBe(400);
    expect((await send(token, "not json")).status).toBe(400);
    expect((await send(token, zeroBatch())).status).toBe(200);
    expect((await send(token, zeroBatch())).status).toBe(429);
    expect((await send(`kal_${"c".repeat(43)}`, zeroBatch())).status).toBe(401);
    // 400s still take from the hourly allowance; only accepted batches are logged.
    expect(await logOf(person.id)).toHaveLength(1);
    expect((await logOf(person.id))[0]!.deviceId).toBe(deviceId);
  });

  it("keeps no record ids, titles or values, only counts", async () => {
    const person = await createUser({ timeZone: TZ });
    const { token } = await linkPhone(person.id);
    await send(token, fullBatch());
    const text = JSON.stringify(await logOf(person.id));
    for (const secret of [runId, weighId, sleepId, "Morning run", "80.24", "57.6", SAMSUNG])
      expect(text).not.toContain(secret);
  });
});

describe("30 days", () => {
  it("prunes rows older than 30 days when a phone writes, and lists only the kept ones", async () => {
    const person = await createUser({ timeZone: TZ });
    const { token, deviceId } = await linkPhone(person.id);
    const old = (days: number) => ({
      deviceId,
      userId: person.id,
      tz: TZ,
      empty: true,
      receivedAt: new Date(Date.now() - days * 86_400_000),
    });
    await db.insert(healthConnectUpdates).values([old(45), old(31), old(29)]);
    // Not yet pruned: the page leaves out what is past the window anyway.
    const before = (await listUpdates(person.id, [deviceId])).get(deviceId)!;
    expect(before.count).toBe(1);
    expect(before.updates).toHaveLength(1);

    await send(token, zeroBatch());
    const ages = (await logOf(person.id)).map((r) =>
      // The database's clock may be a moment ahead of this process's.
      Math.max(0, Math.round((Date.now() - r.receivedAt.getTime()) / 86_400_000)),
    );
    expect(ages.sort((a, b) => a - b)).toEqual([0, 29]);
  });
});

describe("the latest updates of each phone", () => {
  it("lists the newest ten of each phone and counts them, for the owner only", async () => {
    const person = await createUser({ timeZone: TZ });
    const one = await linkPhone(person.id);
    const two = await linkPhone(person.id);
    const at = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    await db.insert(healthConnectUpdates).values([
      ...Array.from({ length: 12 }, (_, i) => ({
        deviceId: one.deviceId,
        userId: person.id,
        tz: TZ,
        workouts: i,
        empty: false,
        receivedAt: at(i * 60),
      })),
      { deviceId: two.deviceId, userId: person.id, tz: TZ, empty: true, receivedAt: at(5) },
    ]);
    const logs = await listUpdates(person.id, [one.deviceId, two.deviceId]);
    expect(logs.get(one.deviceId)!.count).toBe(12);
    expect(logs.get(one.deviceId)!.updates.map((u) => u.workouts)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(logs.get(two.deviceId)).toMatchObject({ count: 1, updates: [{ empty: true }] });
    expect(
      (await listUpdates(person.id, [one.deviceId], 3)).get(one.deviceId)!.updates,
    ).toHaveLength(3);

    const other = await createUser({ timeZone: TZ });
    const theirs = await listUpdates(other.id, [one.deviceId, two.deviceId]);
    expect([...theirs.values()].every((log) => log.count === 0 && !log.updates.length)).toBe(true);
    expect(await allUpdates(other.id)).toEqual([]);
    expect((await listUpdates("not-a-uuid", [one.deviceId])).size).toBe(0);
  });

  it("goes with the phone when it is unlinked", async () => {
    const person = await createUser({ timeZone: TZ });
    const kept = await linkPhone(person.id);
    const gone = await linkPhone(person.id);
    await send(kept.token, zeroBatch());
    await send(gone.token, zeroBatch());
    await send(gone.token, fullBatch());
    expect(await revokeDevice(person.id, gone.deviceId)).toBe(true);
    expect((await logOf(person.id)).map((r) => r.deviceId)).toEqual([kept.deviceId]);
  });
});

describe("export and Delete my data", () => {
  it("exports each phone's updates without ids and removes them with the data", async () => {
    const person = await createUser({ timeZone: TZ });
    const { token } = await linkPhone(person.id);
    await send(token, { tz: TZ, appVersion: "1.1 (2)", firstReadDays: 30 });
    await send(token, fullBatch());
    const data = (await exportUserData(person.id))!;
    expect(data.devices).toHaveLength(1);
    const updates = data.devices[0]!.updates;
    expect(updates).toEqual([
      expect.objectContaining({ firstReadDays: 30, empty: true, appVersion: "1.1 (2)" }),
      expect.objectContaining({ stepsToday: 6812, workouts: 1, weighIns: 1, empty: false }),
    ]);
    expect(updates[0]).not.toHaveProperty("id");
    expect(updates[0]).not.toHaveProperty("deviceId");
    expect(typeof updates[0]!.receivedAt).toBe("string");

    await deleteUserData(person.id);
    expect(await logOf(person.id)).toHaveLength(0);
  });
});

describe('the rule behind "Nothing has arrived yet"', () => {
  it("is false until a Health Connect record of the person is stored, in any table", async () => {
    const person = await createUser({ timeZone: TZ });
    const { token } = await linkPhone(person.id);
    await send(token, zeroBatch());
    expect(await hasHealthConnectRecords(person.id)).toBe(false);
    // Records from elsewhere do not count.
    await db.insert(activities).values({
      userId: person.id,
      category: "walking",
      type: "steps",
      title: "Steps",
      startedAt: new Date(),
      tz: TZ,
      localDate: today(),
      steps: 4000,
      source: "manual",
    });
    expect(await hasHealthConnectRecords(person.id)).toBe(false);
    expect(await hasHealthConnectRecords("not-a-uuid")).toBe(false);

    const base = { tz: TZ, localDate: today(), source: "health_connect" as const };
    const cases = [
      (userId: string) =>
        db.insert(activities).values({
          ...base,
          userId,
          category: "walking",
          type: "steps",
          title: "Steps",
          startedAt: new Date(),
          steps: 10,
          externalId: "steps:x",
        }),
      (userId: string) =>
        db.insert(bodyMeasurements).values({
          ...base,
          userId,
          code: "weight",
          unit: "kg",
          value: 70,
          measuredAt: new Date(),
          externalId: "w-1",
        }),
      (userId: string) =>
        db.insert(heartRates).values({
          ...base,
          userId,
          kind: "resting",
          startedAt: new Date(),
          bpm: 60,
          externalId: "resting:x",
        }),
      (userId: string) =>
        db.insert(sleepSessions).values({
          ...base,
          userId,
          startedAt: new Date(Date.now() - 8 * 3_600_000),
          endedAt: new Date(),
          durationMin: 480,
          externalId: "s-1",
        }),
    ];
    for (const add of cases) {
      const someone = await createUser({ timeZone: TZ });
      expect(await hasHealthConnectRecords(someone.id)).toBe(false);
      await add(someone.id);
      expect(await hasHealthConnectRecords(someone.id)).toBe(true);
    }
    expect(await hasHealthConnectRecords(person.id)).toBe(false);
  });

  it("turns true once a phone's batch stored a record", async () => {
    const person = await createUser({ timeZone: TZ });
    const { token } = await linkPhone(person.id);
    await send(token, zeroBatch());
    expect(await hasHealthConnectRecords(person.id)).toBe(false);
    await send(token, { tz: TZ, steps: [{ date: today(), count: 6812 }] });
    expect(await hasHealthConnectRecords(person.id)).toBe(true);
  });
});
