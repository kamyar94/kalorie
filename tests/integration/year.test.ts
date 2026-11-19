// The Trends year card against Postgres: a calendar year of day totals for one nutrient, counted
// on each meal's own local date (a time zone ahead of and one behind UTC), deleted meals and failed
// ones without items left out the same way Trends leaves them out, water from drinks as on Today
// (alcohol not counted, water on its own not a meal), steps and the activity part of the water
// goal from Move, a nutrient without a target, the year kept to the years with meals, and only the
// person's own data. "Today" is passed in, so nothing here depends on the date the tests run.
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { activities } from "@/db/schema";
import { createManualMeal } from "@/lib/meals/manual";
import { getTrends } from "@/lib/trends/service";
import { dayLook, yearTarget, type YearData } from "@/lib/trends/year";
import { firstMealYear, getYear } from "@/lib/trends/year-service";
import { createItem, createMeal, createUser } from "@/tests/helpers/factories";

const TODAY = "2026-11-14";

const meal = (userId: string, localDate: string, values: Parameters<typeof createMeal>[1] = {}) =>
  createMeal(userId, {
    localDate,
    eatenAt: new Date(`${localDate}T12:30:00Z`),
    tz: "UTC",
    ...values,
  });

const dayOf = (data: YearData, date: string) => data.days.find((d) => d.date === date);

describe("the year card's days", () => {
  it("counts each meal on the local date of its own time zone", async () => {
    const user = await createUser({ timeZone: "Asia/Tehran" });
    const add = (eatenAt: string, tz: string, energy: number) =>
      createManualMeal(user.id, {
        eatenAt,
        tz,
        items: [{ name: "Kuku sabzi", nutrients: { energy, protein: energy / 20 } }],
      });
    // Tehran is 3:30 ahead of UTC: 20:00 UTC on 31 December is 23:30 that evening, 21:00 UTC is
    // 00:30 on 1 January. Los Angeles is 8 hours behind: 05:00 UTC on 1 January is 21:00 on
    // 31 December.
    await add("2025-12-31T20:00:00Z", "Asia/Tehran", 700);
    await add("2025-12-31T21:00:00Z", "Asia/Tehran", 300);
    await add("2026-01-01T05:00:00Z", "America/Los_Angeles", 500);

    const last = await getYear(user.id, { year: "2025", today: TODAY });
    expect(last.year).toBe(2025);
    expect(last.days.map((d) => [d.date, d.meals, d.energy, d.protein])).toEqual([
      ["2025-12-31", 2, 1200, 60],
    ]);
    const now = await getYear(user.id, { year: "2026", today: TODAY });
    expect(now.days.map((d) => [d.date, d.meals, d.energy])).toEqual([["2026-01-01", 1, 300]]);
    expect(now.firstYear).toBe(2025);
    expect(await firstMealYear(user.id)).toBe(2025);
  });

  it("leaves out deleted meals and failed ones without items, as Trends does", async () => {
    const user = await createUser();
    await meal(user.id, "2025-03-01", { totals: { energy: 800, protein: 40 } });
    await meal(user.id, "2025-03-01", { totals: { energy: 999 }, deletedAt: new Date() });
    // A photo that was not food, and one without an AI key yet: nothing in them.
    await meal(user.id, "2025-03-02", { status: "failed", totals: {} });
    await meal(user.id, "2025-03-02", { status: "failed", totals: {} });
    // A meal whose analysis failed again keeps its items, and they count as on Today.
    await meal(user.id, "2025-03-03", { status: "failed", totals: { energy: 450 } });
    // Someone else's meal on the same day.
    await meal((await createUser()).id, "2025-03-01", { totals: { energy: 3000 } });

    const year = await getYear(user.id, { year: "2025", today: TODAY });
    expect(year.days.map((d) => [d.date, d.meals, d.energy])).toEqual([
      ["2025-03-01", 1, 800],
      ["2025-03-03", 1, 450],
    ]);
    const ctx = {
      today: TODAY,
      metric: "energy" as const,
      target: yearTarget("energy", year.targets, year.waterGoalMl),
      max: 0,
    };
    expect(dayLook("2025-03-02", dayOf(year, "2025-03-02"), ctx)).toEqual({ state: "none" });
    // 800 of the default 2,000 kcal.
    expect(dayLook("2025-03-01", dayOf(year, "2025-03-01"), ctx)).toMatchObject({
      state: "bin",
      bin: "far_under",
      percent: 40,
    });

    const trends = await getTrends(user.id, "week", "2025-03-03");
    expect(trends.loggedDays).toBe(2);
    expect(trends.days.find((d) => d.date === "2025-03-02")!.meals).toBe(0);
    expect(trends.days.find((d) => d.date === "2025-03-01")!.totals.energy).toBe(800);
  });

  it("adds water from drinks as Today does, and steps and the water goal from Move", async () => {
    const user = await createUser();
    const lunch = await meal(user.id, "2025-06-10", { totals: { energy: 600 } });
    await createItem(user.id, lunch.id, { name: "Rice", kind: "dish", grams: 200 });
    await createItem(user.id, lunch.id, { name: "Doogh", kind: "drink", ml: 250, grams: 250 });
    await createItem(user.id, lunch.id, {
      name: "Beer",
      kind: "drink",
      ml: 330,
      grams: 330,
      nutrients: { alcohol: 13 },
    });
    // A glass from the Water card: water on its own, not a meal of the day.
    await createManualMeal(user.id, {
      eatenAt: "2025-06-10T08:00:00Z",
      tz: "UTC",
      items: [{ name: "Water", kind: "drink", ml: 500, grams: 500, nutrients: { water: 500 } }],
    });
    // A day with only water, and a day with only steps.
    await createManualMeal(user.id, {
      eatenAt: "2025-06-11T08:00:00Z",
      tz: "UTC",
      items: [{ name: "Water", kind: "drink", ml: 300, grams: 300, nutrients: { water: 300 } }],
    });
    const move = (localDate: string, values: Partial<typeof activities.$inferInsert>) =>
      db.insert(activities).values({
        userId: user.id,
        category: "cardio",
        type: "run",
        title: "Run",
        startedAt: new Date(`${localDate}T07:00:00Z`),
        tz: "UTC",
        localDate,
        durationMin: 60,
        intensity: "moderate",
        source: "manual",
        ...values,
      });
    await move("2025-06-10", {});
    await move("2025-06-10", {
      category: "walking",
      type: "steps",
      title: "Steps",
      durationMin: null,
      intensity: null,
      steps: 8240,
    });
    await move("2025-06-12", {
      category: "walking",
      type: "steps",
      title: "Steps",
      durationMin: null,
      intensity: null,
      steps: 4100,
    });

    const year = await getYear(user.id, { year: "2025", metric: "water", today: TODAY });
    expect(year.metric).toBe("water");
    // 1,800 ml without a sex in the profile; an hour of running adds 0.5 L.
    expect(year.waterGoalMl).toBe(1800);
    expect(dayOf(year, "2025-06-10")).toMatchObject({
      meals: 1,
      waterMl: 750,
      steps: 8240,
      waterGoalMl: 2300,
    });
    expect(dayOf(year, "2025-06-11")).toMatchObject({ meals: 0, waterMl: 300, steps: 0 });
    expect(dayOf(year, "2025-06-12")).toMatchObject({ meals: 0, waterMl: 0, steps: 4100 });

    const target = yearTarget("water", year.targets, year.waterGoalMl);
    const water = { today: TODAY, metric: "water" as const, target, max: 0 };
    // 750 of the day's 2,300 ml.
    expect(dayLook("2025-06-10", dayOf(year, "2025-06-10"), water)).toMatchObject({
      state: "bin",
      percent: 33,
    });
    // Water on its own makes a logged day for water, not for calories.
    expect(dayLook("2025-06-11", dayOf(year, "2025-06-11"), water)).toMatchObject({
      state: "bin",
      percent: 17,
    });
    const energy = {
      ...water,
      metric: "energy" as const,
      target: yearTarget("energy", year.targets, 0),
    };
    expect(dayLook("2025-06-11", dayOf(year, "2025-06-11"), energy)).toEqual({ state: "none" });
    expect(dayLook("2025-06-12", dayOf(year, "2025-06-12"), energy)).toEqual({ state: "none" });
  });

  it("reads one nutrient without a target and says when a day has no value for it", async () => {
    const user = await createUser();
    await meal(user.id, "2025-04-01", { totals: { energy: 500, fat_mono: 12 } });
    await meal(user.id, "2025-04-01", { totals: { energy: 300, fat_mono: 4 } });
    await meal(user.id, "2025-04-02", { totals: { energy: 400 } });
    await meal(user.id, "2025-04-03", { totals: { energy: 400, fat_mono: 2 } });

    const year = await getYear(user.id, { year: "2025", metric: "fat_mono", today: TODAY });
    expect(year.days.map((d) => [d.date, d.value])).toEqual([
      ["2025-04-01", 16],
      ["2025-04-02", null],
      ["2025-04-03", 2],
    ]);
    expect(yearTarget("fat_mono", year.targets, year.waterGoalMl)).toBeNull();
    const ctx = { today: TODAY, metric: "fat_mono" as const, target: null, max: 16 };
    expect(dayLook("2025-04-01", dayOf(year, "2025-04-01"), ctx)).toEqual({
      state: "scale",
      level: 4,
      amount: 16,
    });
    expect(dayLook("2025-04-02", dayOf(year, "2025-04-02"), ctx)).toEqual({ state: "unknown" });
    expect(dayLook("2025-04-03", dayOf(year, "2025-04-03"), ctx)).toMatchObject({ level: 1 });
  });

  it("reads steps, active minutes, workouts and energy from Move, by each one's local day", async () => {
    const user = await createUser({ timeZone: "Asia/Tehran" });
    const move = (values: Partial<typeof activities.$inferInsert> & { localDate: string }) =>
      db.insert(activities).values({
        userId: user.id,
        category: "cardio",
        type: "run",
        title: "Run",
        startedAt: new Date(`${values.localDate}T07:00:00Z`),
        tz: "UTC",
        durationMin: 30,
        intensity: "moderate",
        source: "manual",
        ...values,
      });
    const steps = (localDate: string, count: number, source: "health_connect" | "import") =>
      move({
        localDate,
        category: "walking",
        type: "steps",
        title: "Steps",
        durationMin: null,
        intensity: null,
        steps: count,
        source,
        sourceApp: source === "import" ? "samsung-health" : "com.android.healthconnect.phone.0a1b",
        externalId: `${source}:${localDate}`,
      });
    // Steps imported in March, from Health Connect from 16 November.
    await steps("2025-03-02", 9000, "import");
    await steps("2026-11-16", 4701, "health_connect");
    await steps("2026-11-17", 4150, "health_connect");
    await steps("2026-11-17", 12_000, "import");
    // A vigorous run of 20 minutes counts 40 for the WHO week; strength and light yoga do not.
    await move({
      localDate: "2026-11-17",
      durationMin: 20,
      intensity: "vigorous",
      energyKcal: 210,
    });
    await move({
      localDate: "2026-11-17",
      category: "strength",
      type: "weights",
      title: "Gym",
      durationMin: 45,
      energyKcal: 190,
    });
    // A late yoga in Tehran on the evening of the 12th (UTC) is on the 13th there.
    await move({
      localDate: "2026-11-13",
      startedAt: new Date("2026-11-12T21:00:00Z"),
      tz: "Asia/Tehran",
      category: "mobility",
      type: "yoga",
      title: "Yoga",
      durationMin: 25,
      intensity: "light",
    });

    const year = await getYear(user.id, { metric: "steps", today: "2026-11-18" });
    expect(year.metric).toBe("steps");
    expect(year.stepGoal).toBe(7000);
    // The pager reaches back to the first activity, before any meal.
    expect(year.firstYear).toBe(2025);
    expect(year.stepsSince).toBe("2026-11-16");
    expect(
      year.days.map((d) => [
        d.date,
        d.steps,
        d.activeMinutes,
        d.whoMinutes,
        d.workouts,
        d.activityEnergy,
      ]),
    ).toEqual([
      ["2026-11-13", 0, 25, 0, 1, null],
      ["2026-11-16", 4701, 0, 0, 0, null],
      // Health Connect's count wins over the import.
      ["2026-11-17", 4150, 65, 40, 2, 400],
    ]);
    expect(year.days.every((d) => d.activity && d.meals === 0 && d.value === null)).toBe(true);

    const target = yearTarget("steps", year.targets, year.waterGoalMl, year.stepGoal);
    const ctx = { today: "2026-11-18", metric: "steps" as const, target, max: 0 };
    expect(dayLook("2026-11-16", dayOf(year, "2026-11-16"), ctx)).toMatchObject({
      state: "more",
      bin: "more_under",
      percent: 67,
    });
    expect(dayLook("2026-11-13", dayOf(year, "2026-11-13"), ctx)).toEqual({ state: "none" });
    const active = {
      ...ctx,
      metric: "active_minutes" as const,
      target: yearTarget("active_minutes", year.targets, year.waterGoalMl),
    };
    // 40 of 150 / 7 = 21.4 minutes: 186 %.
    expect(dayLook("2026-11-17", dayOf(year, "2026-11-17"), active)).toMatchObject({
      state: "more",
      bin: "more_high",
      percent: 186,
    });
    expect(dayLook("2026-11-13", dayOf(year, "2026-11-13"), active)).toMatchObject({
      bin: "more_low",
      percent: 0,
    });

    const last = await getYear(user.id, {
      year: "2025",
      metric: "active_minutes",
      today: "2026-11-18",
    });
    expect(last.days.map((d) => [d.date, d.steps])).toEqual([["2025-03-02", 9000]]);
    expect(last.stepsSince).toBeNull();
    // Someone else sees none of it.
    const other = await getYear((await createUser()).id, { metric: "steps", today: "2026-11-18" });
    expect(other.days).toEqual([]);
  });

  it("keeps the year to the years with meals and the metric to known nutrients", async () => {
    const user = await createUser();
    await meal(user.id, "2024-08-01", { totals: { energy: 1000 } });
    expect((await getYear(user.id, { year: "2019", today: TODAY })).year).toBe(2024);
    expect((await getYear(user.id, { year: "2031", today: TODAY })).year).toBe(2026);
    expect((await getYear(user.id, { year: "soon", today: TODAY })).year).toBe(2026);
    const odd = await getYear(user.id, { year: "2024", metric: "fdc:1008", today: TODAY });
    expect(odd.metric).toBe("energy");
    expect(odd.days).toHaveLength(1);

    // A new person: only the current year, nothing in it.
    const fresh = await getYear((await createUser()).id, { year: "2025", today: TODAY });
    expect(fresh).toMatchObject({ year: 2026, firstYear: 2026, days: [] });
    // The current year stops at today.
    await meal(user.id, "2026-11-20", { totals: { energy: 900 } });
    const now = await getYear(user.id, { today: TODAY });
    expect(now.days.some((d) => d.date > TODAY)).toBe(false);
  });
});
