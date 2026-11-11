// Move against Postgres: points, level, streak and the week from stored activities, badges stored
// once (and kept when the data behind them goes), the water-goal badge from drinks in meals,
// Today's Move card, the export, "Delete my data", and that it all stays with its owner.
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { activities, userBadges } from "@/db/schema";
import { deleteUserData, exportUserData } from "@/lib/account/data";
import { localParts, shiftLocalDate } from "@/lib/meals/time";
import { getMoveDay, getMoveSummary } from "@/lib/move/service";
import { weekStart } from "@/lib/move/week";
import { createItem, createMeal, createUser } from "@/tests/helpers/factories";

const TZ = "UTC";
const today = localParts(new Date(), TZ).date;
const day = (n: number) => shiftLocalDate(today, -n);

const activity = (
  userId: string,
  localDate: string,
  values: Partial<typeof activities.$inferInsert> = {},
) =>
  db.insert(activities).values({
    userId,
    category: "cardio",
    type: "run",
    title: "Run",
    startedAt: new Date(`${localDate}T07:00:00Z`),
    tz: TZ,
    localDate,
    durationMin: 30,
    intensity: "moderate",
    source: "manual",
    ...values,
  });

const stepsDay = (userId: string, localDate: string, steps: number, source: "import" | "manual") =>
  activity(userId, localDate, {
    category: "walking",
    type: "steps",
    title: "Steps",
    durationMin: null,
    intensity: null,
    steps,
    source,
    sourceApp: source === "import" ? "samsung-health" : null,
    externalId: source === "import" ? `samsung:steps:${localDate}` : null,
  });

const water = async (userId: string, localDate: string, ml: number) => {
  const meal = await createMeal(userId, {
    eatenAt: new Date(`${localDate}T12:00:00Z`),
    localDate,
    tz: TZ,
    slot: "drink",
  });
  await createItem(userId, meal.id, { name: "Water", kind: "drink", ml, grams: ml });
};

describe("Move", () => {
  it("adds up points, the level, the streak and the week, and stores badges once", async () => {
    const user = await createUser({ timeZone: TZ });
    // Three days in a row: 45 min strength from openGym + steps today, a run and steps before.
    await activity(user.id, day(0), {
      category: "strength",
      type: "weights",
      title: "Full body A",
      durationMin: 45,
      source: "opengym",
      externalId: "gym-1",
    });
    await stepsDay(user.id, day(0), 6240, "import");
    await stepsDay(user.id, day(0), 3000, "manual");
    await activity(user.id, day(1), { durationMin: 30, intensity: "vigorous" });
    await stepsDay(user.id, day(2), 10_200, "import");
    // Enough water for the goal raised by the activity (at most 1.8 + 0.4 L).
    for (const n of [0, 1, 2]) await water(user.id, day(n), 2300);

    const summary = await getMoveSummary(user.id, today);
    // Today 45 + 15 + 30 (6,240 steps); yesterday 60; two days ago 50 (10,200 steps).
    expect(summary.points).toEqual({
      total: 200,
      today: 90,
      level: 2,
      levelStart: 150,
      nextLevelAt: 450,
    });
    expect(summary.streak).toEqual({ days: 3, activeToday: true });
    expect(summary.week.start).toBe(weekStart(today));
    const earned = Object.fromEntries(
      summary.badges.filter((b) => b.earnedOn).map((b) => [b.code, b.earnedOn]),
    );
    expect(earned).toMatchObject({
      first_workout: day(1),
      streak_3: day(0),
      steps_10k: day(2),
      water_3: day(0),
    });
    expect(summary.badges.find((b) => b.code === "water_7")!.earnedOn).toBeNull();
    const stored = await db.select().from(userBadges).where(eq(userBadges.userId, user.id));
    expect(stored.map((b) => b.code).sort()).toEqual(Object.keys(earned).sort());

    // Earned stays earned when the data behind it is removed.
    await db.delete(activities).where(eq(activities.userId, user.id));
    const after = await getMoveSummary(user.id, today);
    expect(after.points.total).toBe(0);
    expect(after.badges.find((b) => b.code === "steps_10k")!.earnedOn).toBe(day(2));

    // Someone else has none of it.
    const other = await getMoveSummary((await createUser()).id, today);
    expect(other.points.total).toBe(0);
    expect(other.badges.every((b) => b.earnedOn === null)).toBe(true);
  });

  it("raises the water goal of an active day for the water badge", async () => {
    const user = await createUser({ timeZone: TZ });
    for (const n of [0, 1, 2]) await water(user.id, day(n), 1900);
    // An hour of running two days ago: the goal that day is 1.8 + 0.5 L, so 1.9 L falls short.
    await activity(user.id, day(2), { durationMin: 60 });
    const summary = await getMoveSummary(user.id, today);
    expect(summary.badges.find((b) => b.code === "water_3")!.earnedOn).toBeNull();
    await water(user.id, day(2), 500);
    const again = await getMoveSummary(user.id, today);
    expect(again.badges.find((b) => b.code === "water_3")!.earnedOn).toBe(day(0));
  });

  it("fills Today's Move card for a day", async () => {
    const user = await createUser({ timeZone: TZ });
    await activity(user.id, day(0), {
      category: "strength",
      type: "weights",
      title: "Full body A",
      durationMin: 45,
      source: "opengym",
      externalId: "gym-2",
    });
    await activity(user.id, day(0), {
      category: "mobility",
      type: "yoga",
      durationMin: 15,
      intensity: "light",
    });
    await stepsDay(user.id, day(0), 6240, "import");
    expect(await getMoveDay(user.id, today)).toEqual({
      activeMinutes: 60,
      activeLabel: "Strength, openGym",
      steps: 6240,
      stepsSource: "imported",
      points: 45 + 15 + 7 + 30,
      sweatMinutes: 45,
    });
    expect(await getMoveDay(user.id, day(5))).toEqual({
      activeMinutes: 0,
      activeLabel: null,
      steps: 0,
      stepsSource: null,
      points: 0,
      sweatMinutes: 0,
    });
  });

  it("exports the badges and deletes them with the rest", async () => {
    const user = await createUser({ timeZone: TZ });
    await activity(user.id, day(0));
    await getMoveSummary(user.id, today);
    expect((await exportUserData(user.id))!.badges).toEqual([
      { code: "first_workout", earnedOn: day(0) },
    ]);
    await deleteUserData(user.id);
    const left = await db.execute(
      sql`select count(*)::int as n from user_badges where user_id = ${user.id}`,
    );
    expect(left.rows[0]).toEqual({ n: 0 });
  });
});
