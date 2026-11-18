// Trends "Activity" against Postgres: a week's steps (Health Connect's count wins), timed minutes
// by category and workouts per day, days without any activity left out of the averages, the
// energy from activity next to the energy eaten, a day's view reading its whole week for the WHO
// line, a month's full weeks, and that it all stays with its owner.
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { activities } from "@/db/schema";
import { localParts, shiftLocalDate } from "@/lib/meals/time";
import { weekStart } from "@/lib/move/week";
import { getTrends } from "@/lib/trends/service";
import { createMeal, createUser } from "@/tests/helpers/factories";

const TZ = "UTC";
const today = localParts(new Date(), TZ).date;
// The last full Monday-to-Sunday week before today's, so every day of it is in the past.
const monday = shiftLocalDate(weekStart(today), -7);
const d = (i: number) => shiftLocalDate(monday, i);

const add = (
  userId: string,
  values: Partial<typeof activities.$inferInsert> & { localDate: string },
) =>
  db.insert(activities).values({
    userId,
    category: "cardio",
    type: "run",
    title: "Run",
    startedAt: new Date(`${values.localDate}T07:00:00Z`),
    tz: TZ,
    durationMin: 30,
    intensity: "moderate",
    source: "manual",
    ...values,
  });

const steps = (
  userId: string,
  localDate: string,
  count: number,
  source: "health_connect" | "import",
) =>
  add(userId, {
    localDate,
    category: "walking",
    type: "steps",
    title: "Steps",
    durationMin: null,
    intensity: null,
    steps: count,
    source,
    sourceApp: source === "import" ? "samsung-health" : "com.android.healthconnect.phone.0a1b",
    externalId: `${source}:steps:${localDate}`,
  });

describe("Trends: activity", () => {
  it("adds up a week and leaves days without data out of the averages", async () => {
    const user = await createUser({ timeZone: TZ });
    await steps(user.id, d(0), 4701, "health_connect");
    await steps(user.id, d(1), 4150, "health_connect");
    await steps(user.id, d(1), 9000, "import");
    await add(user.id, {
      localDate: d(1),
      durationMin: 30,
      intensity: "vigorous",
      energyKcal: 320,
    });
    await add(user.id, {
      localDate: d(2),
      category: "strength",
      type: "weights",
      title: "Gym",
      durationMin: 40,
      energyKcal: 187,
    });
    await steps(user.id, d(2), 7480, "health_connect");
    await add(user.id, {
      localDate: d(3),
      category: "mobility",
      type: "yoga",
      title: "Yoga",
      durationMin: 25,
      intensity: "light",
    });
    // A meal on two days: 1,800 and 2,000 kcal.
    for (const [date, energy] of [
      [d(1), 1800],
      [d(2), 2000],
    ] as const)
      await createMeal(user.id, {
        eatenAt: new Date(`${date}T12:00:00Z`),
        localDate: date,
        tz: TZ,
        totals: { energy },
      });

    const week = await getTrends(user.id, "week", d(6));
    const a = week.activity;
    expect(a.days.map((x) => [x.date, x.steps, x.activeMinutes, x.workouts])).toEqual([
      [d(0), 4701, 0, 0],
      [d(1), 4150, 30, 1],
      [d(2), 7480, 40, 1],
      [d(3), null, 25, 1],
      [d(4), null, null, 0],
      [d(5), null, null, 0],
      [d(6), null, null, 0],
    ]);
    // Steps from 3 days, minutes from the 4 days with any record: no zeros for the empty days.
    expect(a.stepDays).toBe(3);
    expect(a.loggedDays).toBe(4);
    expect(a.averageSteps).toBe((4701 + 4150 + 7480) / 3);
    expect(a.averageMinutes).toBe((0 + 30 + 40 + 25) / 4);
    expect(a.workouts).toBe(3);
    expect(a.minutes).toMatchObject({ cardio: 30, strength: 40, mobility: 25 });
    expect(a.averageEnergy).toBe((320 + 187) / 2);
    expect(a.who).toEqual({ kind: "week", label: null, cardio: 60, strengthDays: 1, stepDays: 1 });
    // Eaten: the meals' days only.
    expect(week.average.energy).toBe(1900);

    // A day reads its whole week for the WHO line; its own numbers are the day's.
    const day = await getTrends(user.id, "day", d(3));
    expect(day.activity.days).toHaveLength(1);
    expect(day.activity.averageSteps).toBeNull();
    expect(day.activity.averageMinutes).toBe(25);
    expect(day.activity.who).toMatchObject({
      kind: "week",
      cardio: 60,
      strengthDays: 1,
      stepDays: 1,
    });

    // A month: the full weeks inside it.
    const month = await getTrends(user.id, "month", d(6));
    expect(month.activity.who).toMatchObject({
      kind: "weeks",
      cardioMet: 0,
      strengthMet: 0,
      stepDays: 1,
    });
    expect(month.activity.stepDays).toBe(3);

    // Someone else has none of it.
    const other = await getTrends((await createUser({ timeZone: TZ })).id, "week", d(6));
    expect(other.activity.loggedDays).toBe(0);
    expect(other.activity.averageSteps).toBeNull();
    expect(other.activity.workouts).toBe(0);
  });
});
