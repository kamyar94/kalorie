// Move for one day against Postgres: the day's activities by their own local date (a run late in
// the evening in Tehran and Los Angeles lands on the right day), points per activity adding up to
// the day's, the step count Health Connect wins with, the week strip, the week card for another
// week; the hint while only the phone's own step counter sends steps (and closing it for good,
// through the route too); and when a phone last sent.
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { activities, devices, healthConnectUpdates, heartRates, users } from "@/db/schema";
import { deleteUserData, exportUserData } from "@/lib/account/data";
import { dismissedHints, dismissHint } from "@/lib/account/hints";
import { createActivity } from "@/lib/activities/service";
import type { SessionUser } from "@/lib/auth/accounts";
import { lastUpdateAt, stepsOnlyFromPhone } from "@/lib/health-connect/log";
import { localParts, shiftLocalDate } from "@/lib/meals/time";
import { getMoveDayView, getMoveSummary } from "@/lib/move/service";
import { weekDays, weekStart } from "@/lib/move/week";
import { createUser } from "@/tests/helpers/factories";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => session.user }));
const hintsRoute = await import("@/app/api/hints/route");

const ORIGIN = "http://127.0.0.1:3201";
const today = localParts(new Date(), "UTC").date;
const day = (n: number) => shiftLocalDate(today, -n);
// A made-up suffix: every phone's step counter has its own.
const PHONE = "com.android.healthconnect.phone.5e6f7a8b";
const SAMSUNG = "com.sec.android.app.shealth";

const steps = (
  userId: string,
  localDate: string,
  count: number,
  source: "health_connect" | "import" | "manual",
  sourceApp: string | null,
) =>
  db.insert(activities).values({
    userId,
    category: "walking",
    type: "steps",
    title: "Steps",
    startedAt: new Date(`${localDate}T12:00:00Z`),
    tz: "UTC",
    localDate,
    steps: count,
    source,
    sourceApp,
    externalId: source === "manual" ? null : `${source}:steps:${localDate}`,
  });

describe("Move for one day", () => {
  it("files activities under their own local day, in Tehran and in Los Angeles", async () => {
    const user = await createUser({ timeZone: "Asia/Tehran" });
    // 21:30 UTC is 01:00 the next day in Tehran (+03:30).
    const tehran = await createActivity(user.id, {
      type: "run",
      startedAt: `${day(3)}T21:30:00Z`,
      tz: "Asia/Tehran",
      durationMin: 30,
    });
    // 05:00 UTC is 21:00 (22:00 in summer time) the day before in Los Angeles.
    const la = await createActivity(user.id, {
      type: "yoga",
      startedAt: `${day(3)}T05:00:00Z`,
      tz: "America/Los_Angeles",
      durationMin: 20,
    });
    expect(tehran!.localDate).toBe(day(2));
    expect(la!.localDate).toBe(day(4));

    const onTehranDay = await getMoveDayView(user.id, day(2), today);
    expect(onTehranDay.activities.map((a) => [a.title, a.localTime])).toEqual([
      ["Running", "01:00"],
    ]);
    const utcDay = await getMoveDayView(user.id, day(3), today);
    expect(utcDay.activities).toEqual([]);
    expect(utcDay.points).toBe(0);
    const onLaDay = await getMoveDayView(user.id, day(4), today);
    expect(onLaDay.activities.map((a) => a.title)).toEqual(["Yoga"]);
    expect(onLaDay.activities[0]!.localTime).toMatch(/^2[12]:00$/);
  });

  it("adds up the day: points per activity, Health Connect's steps, energy and the week", async () => {
    const user = await createUser({ timeZone: "UTC", weightKg: 80 });
    const date = day(1);
    const at = (time: string) => `${date}T${time}:00Z`;
    // Two strength sessions get the bonus, a third does not.
    for (const time of ["18:30", "07:00", "12:00"])
      await createActivity(user.id, {
        type: "weights",
        startedAt: at(time),
        tz: "UTC",
        durationMin: 10,
      });
    await createActivity(user.id, {
      type: "run",
      startedAt: at("07:10"),
      tz: "UTC",
      durationMin: 28,
      distanceKm: 4.1,
    });
    await steps(user.id, date, 9000, "import", "samsung-health");
    await steps(user.id, date, 4150, "health_connect", PHONE);
    await steps(user.id, day(2), 7400, "health_connect", PHONE);

    const view = await getMoveDayView(user.id, date, today);
    // Timed first as they happened, step counts last.
    expect(view.activities.map((a) => [a.title, a.localTime])).toEqual([
      ["Weight training", "07:00"],
      ["Running", "07:10"],
      ["Weight training", "12:00"],
      ["Weight training", "18:30"],
      ["Steps", "12:00"],
      ["Steps", "12:00"],
    ]);
    // 10 + 15, 56 (vigorous), 10 + 15, 10; the phone's 4,150 steps: 20; the import: 0.
    expect(view.activities.map((a) => a.points)).toEqual([25, 56, 25, 10, 20, 0]);
    expect(view.activities.at(-2)!.sourceApp).toBe(PHONE);
    expect(view.points).toBe(136);
    expect(view.steps).toBe(4150);
    expect(view.stepGoal).toBe(7000);
    expect(view.stepsFrom).toEqual({ source: "health_connect", sourceApp: PHONE });
    expect(view.activeMinutes).toBe(58);
    expect(view.workouts).toBe(4);
    // Estimates from 80 kg: three times 3.5 METs for 10 min, 8 METs for 28 min.
    expect(view.energyKcal).toBe(3 * 47 + 299);
    // The week strip: Monday to Sunday of the day's week, days to come marked.
    const monday = weekStart(date);
    expect(view.week.map((d) => d.date)).toEqual(weekDays(monday));
    expect(view.week.find((d) => d.date === date)!.steps).toBe(4150);
    if (weekStart(day(2)) === monday)
      expect(view.week.find((d) => d.date === day(2))!.steps).toBe(7400);
    for (const d of view.week) expect(d.future).toBe(d.date > today);

    // The week card can show the day's week while the rest stays as of today.
    const summary = await getMoveSummary(user.id, today, undefined, day(14));
    expect(summary.week.start).toBe(weekStart(day(14)));
    expect(summary.points.total).toBeGreaterThanOrEqual(view.points);

    // Someone else sees none of it.
    const other = await createUser({ timeZone: "UTC" });
    const theirs = await getMoveDayView(other.id, date, today);
    expect(theirs.activities).toEqual([]);
    expect(theirs.steps).toBe(0);
  });
});

describe("the hint about the phone's own step counter", () => {
  it("shows while only the phone counts steps and nothing came from Samsung Health", async () => {
    const user = await createUser({ timeZone: "UTC" });
    // No Health Connect steps: nothing to say.
    expect(await stepsOnlyFromPhone(user.id)).toBe(false);
    await steps(user.id, day(1), 4701, "health_connect", PHONE);
    await steps(user.id, day(0), 510, "health_connect", PHONE);
    // An import or typed steps do not change it.
    await steps(user.id, day(2), 9000, "import", "samsung-health");
    expect(await stepsOnlyFromPhone(user.id)).toBe(true);

    // A Samsung Health heart rate through Health Connect: the watch is sharing.
    await db.insert(heartRates).values({
      userId: user.id,
      kind: "resting",
      localDate: day(1),
      tz: "UTC",
      startedAt: new Date(`${day(1)}T12:00:00Z`),
      bpm: 58,
      source: "health_connect",
      sourceApp: SAMSUNG,
      externalId: `resting:${day(1)}`,
    });
    expect(await stepsOnlyFromPhone(user.id)).toBe(false);
  });

  it("does not show when another app or several apps wrote a day's steps", async () => {
    const several = await createUser({ timeZone: "UTC" });
    await steps(several.id, day(1), 4701, "health_connect", PHONE);
    await steps(several.id, day(0), 8100, "health_connect", null);
    expect(await stepsOnlyFromPhone(several.id)).toBe(false);
    const fit = await createUser({ timeZone: "UTC" });
    await steps(fit.id, day(0), 8100, "health_connect", "com.google.android.apps.fitness");
    expect(await stepsOnlyFromPhone(fit.id)).toBe(false);
  });

  it("stays closed once closed, through the route; export and Delete my data", async () => {
    const user = await createUser({ timeZone: "UTC" });
    expect(await dismissedHints(user.id)).toEqual([]);
    const post = (body: unknown, origin = ORIGIN) =>
      hintsRoute.POST(
        new NextRequest(`${ORIGIN}/api/hints`, {
          method: "POST",
          headers: {
            origin,
            "x-forwarded-host": "127.0.0.1:3201",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
    session.user = null;
    expect((await post({ hint: "phone-steps-only" })).status).toBe(401);
    session.user = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      timeZone: user.timeZone,
      units: user.units,
    };
    expect((await post({ hint: "phone-steps-only" }, "https://elsewhere.example.org")).status).toBe(
      403,
    );
    expect((await post({ hint: "something-else" })).status).toBe(400);
    expect((await post({ hint: "phone-steps-only" })).status).toBe(200);
    // Closing it again keeps one entry.
    await dismissHint(user.id, "phone-steps-only");
    const [row] = await db
      .select({ hints: users.dismissedHints })
      .from(users)
      .where(eq(users.id, user.id));
    expect(row!.hints).toEqual(["phone-steps-only"]);
    expect(await dismissedHints(user.id)).toEqual(["phone-steps-only"]);
    // Only this person's.
    expect(await dismissedHints((await createUser()).id)).toEqual([]);

    const exported = await exportUserData(user.id);
    expect(exported!.account.preferences.dismissedHints).toEqual(["phone-steps-only"]);
    await deleteUserData(user.id);
    expect(await dismissedHints(user.id)).toEqual([]);
    session.user = null;
  });
});

describe("when a phone last sent", () => {
  it("reads the update log, else the phones' last sync", async () => {
    const user = await createUser({ timeZone: "UTC" });
    expect(await lastUpdateAt(user.id)).toBeNull();
    const [phone] = await db
      .insert(devices)
      .values({ userId: user.id, name: "Phone", tokenHash: `hash-${user.id}` })
      .returning();
    const synced = new Date(Date.now() - 5 * 3_600_000);
    await db.update(devices).set({ lastSyncAt: synced }).where(eq(devices.id, phone!.id));
    expect(await lastUpdateAt(user.id)).toBe(synced.toISOString());
    const received = new Date(Date.now() - 3_600_000);
    await db.insert(healthConnectUpdates).values([
      { deviceId: phone!.id, userId: user.id, tz: "UTC", empty: false, receivedAt: received },
      {
        deviceId: phone!.id,
        userId: user.id,
        tz: "UTC",
        empty: true,
        receivedAt: new Date(Date.now() - 2 * 3_600_000),
      },
    ]);
    expect(await lastUpdateAt(user.id)).toBe(received.toISOString());
    expect(await lastUpdateAt((await createUser()).id)).toBeNull();
  });
});
