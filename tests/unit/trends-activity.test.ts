// Trends "Activity" as plain logic (lib/trends/activity.ts): a day's numbers, days without data
// left out of the averages (not counted as zero), the full weeks of a month, the WHO line for a
// day's week, a week and a month, and the words of the section.
import { describe, expect, it } from "vitest";

import type { ActivityCategory, Intensity } from "@/lib/contracts/activities";
import { shiftLocalDate } from "@/lib/meals/time";
import {
  activityDay,
  averagesCaption,
  computeActivityTrends,
  eatenBurnedText,
  fullWeeks,
  whoText,
  type TrendActivity,
} from "@/lib/trends/activity";

const timed = (
  localDate: string,
  category: ActivityCategory,
  durationMin: number,
  intensity: Intensity = "moderate",
  energyKcal: number | null = null,
): TrendActivity => ({
  localDate,
  category,
  durationMin,
  intensity,
  steps: null,
  stepsOnly: false,
  energyKcal,
});

const steps = (
  localDate: string,
  count: number,
  source: TrendActivity["source"] = "health_connect",
): TrendActivity => ({
  localDate,
  category: "walking",
  durationMin: null,
  intensity: null,
  steps: count,
  stepsOnly: true,
  source,
  energyKcal: null,
});

// Monday 16 to Sunday 22 November 2026.
const MON = "2026-11-16";
const d = (i: number) => shiftLocalDate(MON, i);

describe("a day of activity", () => {
  it("counts steps, minutes by category, workouts and energy; nothing is no data", () => {
    const day = activityDay(d(1), [
      timed(d(1), "cardio", 28, "vigorous", 299),
      timed(d(1), "strength", 10, "moderate", 47),
      steps(d(1), 4150),
      steps(d(1), 9000, "import"),
    ]);
    expect(day).toMatchObject({
      logged: true,
      steps: 4150,
      activeMinutes: 38,
      workouts: 2,
      energyKcal: 346,
    });
    expect(day.minutes).toMatchObject({ cardio: 28, strength: 10, mobility: 0 });
    expect(activityDay(d(2), [])).toMatchObject({
      logged: false,
      steps: null,
      activeMinutes: null,
      workouts: 0,
      energyKcal: null,
    });
    // Steps only: a day with data, 0 active minutes, no energy.
    expect(activityDay(d(3), [steps(d(3), 510)])).toMatchObject({
      logged: true,
      steps: 510,
      activeMinutes: 0,
      energyKcal: null,
    });
  });
});

describe("a week of activity", () => {
  const week = [
    steps(d(0), 4701),
    steps(d(1), 4150),
    timed(d(1), "cardio", 30, "vigorous", 320),
    timed(d(1), "strength", 20, "moderate", 93),
    steps(d(2), 7480),
    timed(d(2), "strength", 40, "moderate", 187),
    timed(d(3), "mobility", 25, "light"),
    steps(d(5), 11_240),
    timed(d(5), "walking", 60, "moderate"),
  ];
  const trends = computeActivityTrends({ range: "week", end: d(6), activities: week });

  it("leaves days without data out of the averages instead of counting zero", () => {
    expect(trends.days.map((x) => x.date)).toEqual([0, 1, 2, 3, 4, 5, 6].map(d));
    // Steps on 4 days, any record on 5; Friday and Sunday have nothing.
    expect(trends.stepDays).toBe(4);
    expect(trends.loggedDays).toBe(5);
    expect(trends.averageSteps).toBe((4701 + 4150 + 7480 + 11_240) / 4);
    expect(trends.averageMinutes).toBe((0 + 50 + 40 + 25 + 60) / 5);
    expect(trends.workouts).toBe(5);
    expect(trends.energyDays).toBe(2);
    expect(trends.averageEnergy).toBe((413 + 187) / 2);
    expect(trends.minutes).toMatchObject({ cardio: 30, strength: 60, mobility: 25, walking: 60 });
    expect(averagesCaption(trends)).toBe(
      "Averages leave out days without data, rather than count them as zero: steps from 4 of 7 days, active minutes from 5.",
    );
  });

  it("counts the WHO week over the period's 7 days", () => {
    // Cardio: 30 vigorous (60) and a 60-minute walk; strength on 2 days; 2 days at 7,000 steps.
    expect(trends.who).toEqual({
      kind: "week",
      label: null,
      cardio: 120,
      strengthDays: 2,
      stepDays: 2,
    });
    expect(whoText(trends.who!)).toBe(
      "WHO week: cardio 120 of 150 min · strength 2 of 2 days · steps on 2 of 7 days",
    );
    // A week from a Wednesday counts its own 7 days: Tuesday's run and lifting are out.
    const rolling = computeActivityTrends({ range: "week", end: d(8), activities: week });
    expect(rolling.who).toMatchObject({ kind: "week", cardio: 60, strengthDays: 1, stepDays: 2 });
  });

  it("gives a day the WHO line of its Monday-to-Sunday week", () => {
    const day = computeActivityTrends({ range: "day", end: d(1), activities: week });
    expect(day.days).toHaveLength(1);
    expect(day.averageSteps).toBe(4150);
    expect(averagesCaption(day)).toBeNull();
    expect(day.who).toEqual({
      kind: "week",
      label: "Week of 16 to 22 November",
      cardio: 120,
      strengthDays: 2,
      stepDays: 2,
    });
    expect(whoText(day.who!)).toBe(
      "WHO week of 16 to 22 November: cardio 120 of 150 min · strength 2 of 2 days · steps on 2 of 7 days",
    );
  });
});

describe("a month of activity", () => {
  it("finds the full Monday-to-Sunday weeks", () => {
    // 30 days from Tuesday 3 November to Wednesday 2 December 2026.
    expect(fullWeeks("2026-11-03", "2026-12-02")).toEqual([
      "2026-11-09",
      "2026-11-16",
      "2026-11-23",
    ]);
    // From a Monday: four full weeks.
    expect(fullWeeks("2026-11-02", "2026-12-01")).toEqual([
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
      "2026-11-23",
    ]);
  });

  it("counts the weeks that met each target", () => {
    const activities = [
      // Week of 9 November: 150 minutes of cardio and strength twice.
      timed("2026-11-10", "cardio", 75, "vigorous"),
      timed("2026-11-11", "strength", 30),
      timed("2026-11-12", "strength", 30),
      steps("2026-11-12", 8000),
      // Week of 16 November: strength once, 7,000 steps on two days.
      timed("2026-11-17", "strength", 30),
      steps("2026-11-18", 7000),
      steps("2026-11-19", 7200),
    ];
    const month = computeActivityTrends({ range: "month", end: "2026-12-02", activities });
    expect(month.who).toEqual({
      kind: "weeks",
      weeks: 3,
      cardioMet: 1,
      strengthMet: 1,
      stepDays: 3,
      days: 21,
    });
    expect(whoText(month.who!)).toBe(
      "WHO weeks, 3 full weeks: cardio target met in 1 · strength in 1 · steps on 3 of 21 days",
    );
    // Nothing at all: no data, no averages.
    const empty = computeActivityTrends({ range: "month", end: "2026-12-02", activities: [] });
    expect(empty.averageSteps).toBeNull();
    expect(empty.averageMinutes).toBeNull();
    expect(empty.workouts).toBe(0);
  });
});

describe("eaten and burned", () => {
  it("puts the average eaten next to the energy from activity", () => {
    expect(eatenBurnedText({ range: "week", eaten: 1903.4, burned: 214, target: 1859 })).toBe(
      "Daily average: eaten 1,903 kcal, burned in activity 214 kcal, target 1,859 + activity.",
    );
    expect(eatenBurnedText({ range: "day", eaten: null, burned: null, target: null })).toBe(
      "The day: no meals logged, no energy from activity.",
    );
  });
});
