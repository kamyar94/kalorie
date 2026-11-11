// Body against Postgres: logging a day's measurements through the route (again the same day
// replaces), removing one, imports that update instead of copying, the summary (latest values,
// changes since a day judged from the goal, ratios, the 30-day weight change, merged weigh-ins),
// the weight for activity estimates, the health profile and its "use in analysis" switch, the
// export, "Delete my data", and that everything stays with its owner.
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { bodyMeasurements, users } from "@/db/schema";
import { deleteUserData, exportUserData } from "@/lib/account/data";
import { analysisContext, loadAnalysisInput } from "@/lib/analysis/pipeline";
import type { SessionUser } from "@/lib/auth/accounts";
import { healthForAnalysis } from "@/lib/body/health";
import { getBodySummary, logMeasurements } from "@/lib/body/service";
import { bodyWeightOn } from "@/lib/body/weight";
import type { ImportResult } from "@/lib/contracts/activities";
import type { HealthProfileDto, MeasurementDto } from "@/lib/contracts/body";
import { localParts, shiftLocalDate } from "@/lib/meals/time";
import { createMeal, createUser } from "@/tests/helpers/factories";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => session.user }));

const measurementsRoute = await import("@/app/api/body/measurements/route");
const measurementRoute = await import("@/app/api/body/measurements/[id]/route");
const importRoute = await import("@/app/api/imports/measurements/route");
const healthRoute = await import("@/app/api/body/health/route");

const ORIGIN = "http://127.0.0.1:3201";
const HEADERS = { origin: ORIGIN, "x-forwarded-host": "127.0.0.1:3201" };
const TZ = "UTC";
const today = localParts(new Date(), TZ).date;
const day = (n: number) => shiftLocalDate(today, -n);

const asUser = async (values: Partial<typeof users.$inferInsert> = {}) => {
  const row = await createUser({ timeZone: TZ, ...values });
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    timeZone: row.timeZone,
    units: row.units,
  };
};

const call = (url: string, method: string, body?: unknown) =>
  new NextRequest(`${ORIGIN}${url}`, {
    method,
    headers: { ...HEADERS, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const log = async (localDate: string, values: Record<string, unknown>[]) => {
  const response = await measurementsRoute.POST(
    call("/api/body/measurements", "POST", { localDate, tz: TZ, values }),
  );
  return {
    status: response.status,
    body: (await response.json()) as { measurements: MeasurementDto[]; error?: string },
  };
};

const importBatch = async (records: unknown[]) => {
  const response = await importRoute.POST(call("/api/imports/measurements", "POST", { records }));
  return (await response.json()) as ImportResult;
};

const renpho = (date: string, code: string, value: number) => ({
  externalId: `renpho:${date}T07:00:00.000Z:${code}`,
  sourceApp: "renpho",
  code,
  value,
  measuredAt: `${date}T07:00:00.000Z`,
  tz: TZ,
});

const saveHealth = async (body: Record<string, unknown>) => {
  const response = await healthRoute.PUT(call("/api/body/health", "PUT", body));
  return { status: response.status, body: (await response.json()) as HealthProfileDto };
};

let ann: SessionUser;

beforeAll(async () => {
  ann = await asUser({ goal: "lose", heightCm: 180, weightKg: 95 });
});

beforeEach(async () => {
  session.user = ann;
  await db.execute(sql`delete from rate_limits`);
});

describe("logging measurements", () => {
  it("stores a day's values, replaces a measure logged again that day, and removes one", async () => {
    const person = await asUser();
    session.user = person;
    const first = await log(day(0), [
      { code: "weight", value: 80.4 },
      { code: "waist", value: 92 },
      { code: "custom:", label: "Arm span", unit: "cm", value: 180 },
    ]);
    expect(first.status).toBe(201);
    expect(first.body.measurements.map((m) => [m.code, m.label, m.value, m.source])).toEqual([
      ["weight", "Weight", 80.4, "manual"],
      ["waist", "Waist", 92, "manual"],
      ["custom:arm-span", "Arm span", 180, "manual"],
    ]);
    await log(day(0), [{ code: "waist", value: 91 }]);
    const rows = await db
      .select()
      .from(bodyMeasurements)
      .where(eq(bodyMeasurements.userId, person.id));
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.code === "waist")!.value).toBe(91);

    expect((await log(day(0), [{ code: "weight", value: 900 }])).status).toBe(400);
    expect((await log(shiftLocalDate(today, 3), [{ code: "weight", value: 80 }])).status).toBe(400);

    const weight = rows.find((r) => r.code === "weight")!;
    session.user = ann;
    const ctx = { params: Promise.resolve({ id: weight.id }) };
    expect((await measurementRoute.DELETE(call("/x", "DELETE"), ctx)).status).toBe(404);
    session.user = person;
    expect((await measurementRoute.DELETE(call("/x", "DELETE"), ctx)).status).toBe(200);
    expect(
      await db.select().from(bodyMeasurements).where(eq(bodyMeasurements.id, weight.id)),
    ).toEqual([]);
  });

  it("imports values once and updates them when the file comes again", async () => {
    const person = await asUser();
    session.user = person;
    const records = [renpho(day(3), "weight", 81), renpho(day(3), "body_fat", 25)];
    expect(await importBatch([...records, { ...records[0], code: "nope" }])).toEqual({
      added: 2,
      updated: 0,
      skipped: 1,
    });
    expect(await importBatch([{ ...records[0], value: 80.8 }, records[1]])).toEqual({
      added: 0,
      updated: 2,
      skipped: 0,
    });
    const weights = (await getBodySummary(person.id, today)).weightHistory;
    expect(weights).toEqual([
      expect.objectContaining({ kg: 80.8, source: "import", sourceApp: "renpho" }),
    ]);
  });
});

describe("the Body summary", () => {
  it("judges the changes since a day from the goal, with ratios and the weight history", async () => {
    await logMeasurements(ann.id, {
      localDate: day(40),
      tz: TZ,
      values: [
        { code: "weight", value: 82 },
        { code: "waist", value: 95 },
        { code: "hips", value: 108 },
        { code: "body_fat", value: 26 },
        { code: "muscle", value: 60 },
        { code: "upper_arm_r", value: 38 },
      ],
    });
    await importBatch([renpho(day(10), "weight", 81)]);
    await logMeasurements(ann.id, {
      localDate: day(0),
      tz: TZ,
      values: [
        { code: "weight", value: 80.4 },
        { code: "waist", value: 92 },
        { code: "hips", value: 106 },
        { code: "body_fat", value: 24.5 },
        { code: "muscle", value: 59 },
        { code: "upper_arm_r", value: 38.5 },
      ],
    });
    const summary = await getBodySummary(ann.id, today);
    expect(summary.since).toBe(day(40));
    expect(summary.sinceOptions).toEqual([day(0), day(10), day(40)]);
    const stat = (code: string) => summary.stats.find((s) => s.code === code)!;
    expect(stat("weight")).toMatchObject({ value: 80.4, then: 82, verdict: "better" });
    expect(stat("waist")).toMatchObject({ change: -3, verdict: "better" });
    expect(stat("hips")).toMatchObject({ change: -2, verdict: "better" });
    expect(stat("body_fat").verdict).toBe("better");
    expect(stat("muscle").verdict).toBe("worse");
    expect(stat("upper_arm_r").verdict).toBe("steady");
    expect(stat("waist_to_height").value).toBeCloseTo(92 / 180, 4);
    expect(stat("waist_to_height").verdict).toBe("better");
    expect(stat("waist_to_hip").value).toBeCloseTo(92 / 106, 4);
    // The 30-day change starts from the last weigh-in on or before 30 days ago (40 days ago).
    expect(summary.weight30).toMatchObject({ verdict: "better", days: 40 });
    expect(summary.weight30!.change).toBeCloseTo(-1.6, 5);
    expect(summary.weightHistory.map((w) => [w.date, w.kg, w.source])).toEqual([
      [day(0), 80.4, "manual"],
      [day(10), 81, "import"],
      [day(40), 82, "manual"],
    ]);
    expect(summary.weightSources).toEqual(["Kal", "Renpho"]);

    // Another day to compare with.
    const since10 = await getBodySummary(ann.id, today, day(10));
    expect(since10.stats.find((s) => s.code === "weight")).toMatchObject({ then: 81 });

    // The weight for activity estimates: the last weigh-in on or before the day.
    expect(await bodyWeightOn(ann.id, day(5))).toBe(81);
    expect(await bodyWeightOn(ann.id, day(50))).toBe(95);

    // Nobody else sees any of it.
    const other = await createUser();
    expect((await getBodySummary(other.id, today)).stats).toEqual([]);
  });
});

describe("the health profile", () => {
  it("saves the private fields and the profile's, and shares them with an analysis only when on", async () => {
    const person = await asUser({ goal: "keep", heightCm: 170 });
    session.user = person;
    const saved = await saveHealth({
      allergies: " peanuts ",
      conditions: "high blood pressure",
      notes: "knee surgery 2019",
      heightCm: 181,
      goal: "lose",
      goalRateKgPerWeek: 0.5,
    });
    expect(saved).toEqual({
      status: 200,
      body: {
        allergies: "peanuts",
        conditions: "high blood pressure",
        notes: "knee surgery 2019",
        useInAnalysis: false,
        heightCm: 181,
        birthYear: null,
        goal: "lose",
        goalRateKgPerWeek: 0.5,
      },
    });
    expect(await healthForAnalysis(person.id)).toBeNull();
    const meal = await createMeal(person.id);
    expect(
      analysisContext((await loadAnalysisInput(person.id, meal.id, db))!, false).health,
    ).toBeNull();

    await saveHealth({ useInAnalysis: true });
    expect(await healthForAnalysis(person.id)).toEqual({
      allergies: "peanuts",
      conditions: "high blood pressure",
    });
    expect(
      analysisContext((await loadAnalysisInput(person.id, meal.id, db))!, false).health,
    ).toEqual({
      allergies: "peanuts",
      conditions: "high blood pressure",
    });
    expect((await saveHealth({ heightCm: 20 })).status).toBe(400);
  });
});

describe("export and delete", () => {
  it("exports measurements and the health profile and deletes them with the rest", async () => {
    const person = await asUser();
    session.user = person;
    await log(day(1), [{ code: "weight", value: 70 }]);
    await saveHealth({ allergies: "lactose" });
    const data = await exportUserData(person.id);
    expect(data!.bodyMeasurements.map((m) => [m.code, m.value])).toEqual([["weight", 70]]);
    expect(data!.healthProfile).toEqual({
      conditions: "",
      allergies: "lactose",
      notes: "",
      useInAnalysis: false,
    });
    await deleteUserData(person.id);
    const left = await db.execute(sql`
      select (select count(*) from body_measurements where user_id = ${person.id})::int as m,
             (select count(*) from health_profiles where user_id = ${person.id})::int as h`);
    expect(left.rows[0]).toEqual({ m: 0, h: 0 });
  });
});
