// Activities against Postgres: "+ Activity" through its route (energy estimate from the latest
// weight, steps for a day's total), the list, removing, imports that update instead of copying,
// records the server refuses, the export, "Delete my data", and that everything stays with its
// owner.
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { activities } from "@/db/schema";
import { deleteUserData, exportUserData } from "@/lib/account/data";
import { syncOpenGymActivities } from "@/lib/activities/service";
import type { SessionUser } from "@/lib/auth/accounts";
import type { ActivityDto, ImportResult } from "@/lib/contracts/activities";
import { localParts, shiftLocalDate } from "@/lib/meals/time";
import { createUser } from "@/tests/helpers/factories";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => session.user }));

const listRoute = await import("@/app/api/activities/route");
const itemRoute = await import("@/app/api/activities/[id]/route");
const importRoute = await import("@/app/api/imports/activities/route");

const ORIGIN = "http://127.0.0.1:3201";
const HEADERS = { origin: ORIGIN, "x-forwarded-host": "127.0.0.1:3201" };
const TZ = "Europe/Berlin";
let ann: SessionUser;
let ben: SessionUser;

const asUser = async (weightKg: number | null = 80) => {
  const row = await createUser({ weightKg, timeZone: TZ });
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    timeZone: row.timeZone,
    units: row.units,
  };
};

const call = (url: string, method = "GET", body?: unknown) =>
  new NextRequest(`${ORIGIN}${url}`, {
    method,
    headers: { ...HEADERS, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const today = () => localParts(new Date(), TZ).date;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const add = async (body: Record<string, unknown>) => {
  const response = await listRoute.POST(call("/api/activities", "POST", { tz: TZ, ...body }));
  return {
    status: response.status,
    body: (await response.json()) as ActivityDto & { error?: string },
  };
};

const list = async (from = shiftLocalDate(today(), -30), to = today()) =>
  (
    (await (await listRoute.GET(call(`/api/activities?from=${from}&to=${to}`))).json()) as {
      activities: ActivityDto[];
    }
  ).activities;

const importBatch = async (records: unknown[]) => {
  const response = await importRoute.POST(call("/api/imports/activities", "POST", { records }));
  return { status: response.status, body: (await response.json()) as ImportResult };
};

const stepsRecord = (date: string, steps: number) => ({
  externalId: `samsung:steps:${date}`,
  sourceApp: "samsung-health",
  category: "walking",
  type: "steps",
  title: "Steps",
  startedAt: `${date}T11:00:00.000Z`,
  tz: TZ,
  localDate: date,
  steps,
});

beforeAll(async () => {
  ann = await asUser();
  ben = await asUser(null);
});

beforeEach(async () => {
  session.user = ann;
  await db.execute(sql`delete from rate_limits`);
});

describe("+ Activity", () => {
  it("stores a typed activity with an energy estimate from the weight", async () => {
    const run = await add({ type: "run", startedAt: hoursAgo(2), durationMin: 30, distanceKm: 5 });
    expect(run.status).toBe(201);
    expect(run.body).toMatchObject({
      category: "cardio",
      type: "run",
      title: "Running",
      durationMin: 30,
      distanceM: 5000,
      intensity: "vigorous",
      source: "manual",
      // 8 MET (vigorous) x 80 kg x 0.5 h
      energyKcal: 320,
    });
    const weights = await add({
      type: "weights",
      title: "Full body A",
      startedAt: hoursAgo(5),
      durationMin: 45,
    });
    // 3.5 MET (resistance training) x 80 kg x 0.75 h
    expect(weights.body).toMatchObject({
      title: "Full body A",
      category: "strength",
      energyKcal: 210,
    });
    const steps = await add({ type: "steps", startedAt: hoursAgo(1), steps: 8900 });
    expect(steps.body).toMatchObject({
      category: "walking",
      durationMin: null,
      intensity: null,
      steps: 8900,
      energyKcal: null,
    });
    expect((await add({ type: "run", startedAt: hoursAgo(1) })).status).toBe(400);
    expect((await add({ type: "skydiving", startedAt: hoursAgo(1), durationMin: 5 })).status).toBe(
      400,
    );

    const mine = await list();
    expect(mine.map((a) => a.title)).toEqual(
      expect.arrayContaining(["Running", "Full body A", "Steps (day total)"]),
    );

    // No weight, no estimate.
    session.user = ben;
    expect(
      (await add({ type: "run", startedAt: hoursAgo(1), durationMin: 30 })).body.energyKcal,
    ).toBeNull();
    expect((await list()).map((a) => a.title)).toEqual(["Running"]);
  });

  it("removes the person's own activities only, and never an openGym workout", async () => {
    const { body: walk } = await add({ type: "walk", startedAt: hoursAgo(3), durationMin: 20 });
    session.user = ben;
    expect(
      (await itemRoute.DELETE(call(`/api/activities/${walk.id}`, "DELETE"), ctx(walk.id))).status,
    ).toBe(404);
    session.user = ann;
    expect(
      (await itemRoute.DELETE(call(`/api/activities/${walk.id}`, "DELETE"), ctx(walk.id))).status,
    ).toBe(200);
    expect((await list()).some((a) => a.id === walk.id)).toBe(false);

    await syncOpenGymActivities(
      ann.id,
      [
        {
          id: "gym-1",
          date: today(),
          start: Date.now() - 3_600_000,
          durationMin: 60,
          name: "Legs",
          exercises: ["Squat"],
          bwKg: 80,
        },
      ],
      shiftLocalDate(today(), -120),
    );
    const gym = (await list()).find((a) => a.source === "opengym")!;
    expect(gym).toMatchObject({ title: "Legs", category: "strength", energyKcal: 280 });
    expect(
      (await itemRoute.DELETE(call(`/api/activities/${gym.id}`, "DELETE"), ctx(gym.id))).status,
    ).toBe(409);
  });
});

describe("imports", () => {
  it("adds records once and updates them when the same file comes again", async () => {
    const days = [1, 2, 3].map((n) => shiftLocalDate(today(), -n));
    const first = await importBatch([
      ...days.map((d, i) => stepsRecord(d, 5000 + i * 1000)),
      { ...stepsRecord(days[0]!, 1), externalId: "" },
      "not a record",
    ]);
    expect(first).toEqual({ status: 200, body: { added: 3, updated: 0, skipped: 2 } });
    const again = await importBatch(days.map((d) => stepsRecord(d, 9000)));
    expect(again.body).toEqual({ added: 0, updated: 3, skipped: 0 });
    const imported = (await list()).filter((a) => a.source === "import");
    expect(imported.map((a) => a.steps)).toEqual([9000, 9000, 9000]);
    expect(imported[0]).toMatchObject({ sourceApp: "samsung-health", localDate: days[0] });

    // The same ids are someone else's own records for another person.
    session.user = ben;
    expect((await importBatch(days.map((d) => stepsRecord(d, 100)))).body.added).toBe(3);
    session.user = ann;
    expect((await list()).filter((a) => a.source === "import").map((a) => a.steps)).toEqual([
      9000, 9000, 9000,
    ]);
  });

  it("refuses a batch that is too large or not JSON", async () => {
    expect((await importBatch(Array.from({ length: 2001 }, () => ({})))).status).toBe(413);
    const response = await importRoute.POST(
      new NextRequest(`${ORIGIN}/api/imports/activities`, {
        method: "POST",
        headers: HEADERS,
        body: "nope",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("refuses cross-site requests and people who are not signed in", async () => {
    const response = await importRoute.POST(
      new NextRequest(`${ORIGIN}/api/imports/activities`, {
        method: "POST",
        headers: { origin: "https://evil.example.org", "content-type": "application/json" },
        body: JSON.stringify({ records: [] }),
      }),
    );
    expect(response.status).toBe(403);
    session.user = null;
    expect((await listRoute.GET(call("/api/activities"))).status).toBe(401);
  });
});

describe("export and delete", () => {
  it("exports the activities and deletes them with the rest of the data", async () => {
    const person = await asUser();
    session.user = person;
    await add({ type: "yoga", startedAt: hoursAgo(1), durationMin: 25 });
    await importBatch([stepsRecord(shiftLocalDate(today(), -1), 7000)]);
    const data = await exportUserData(person.id);
    expect(data!.activities.map((a) => [a.title, a.source])).toEqual([
      ["Steps", "import"],
      ["Yoga", "manual"],
    ]);
    await deleteUserData(person.id);
    const left = await db.execute(
      sql`select count(*)::int as n from activities where user_id = ${person.id}`,
    );
    expect(left.rows[0]).toEqual({ n: 0 });
    // Others keep theirs.
    const annLeft = await db
      .select()
      .from(activities)
      .where(sql`user_id = ${ann.id}`);
    expect(annLeft.length).toBeGreaterThan(0);
  });
});
