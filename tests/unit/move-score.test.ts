// Move's rules (lib/move/score.ts): points, levels, the streak, the week by category against the
// WHO targets, and the day each badge is earned.
import { describe, expect, it } from "vitest";

import type { ActivityCategory, Intensity } from "@/lib/contracts/activities";
import { shiftLocalDate } from "@/lib/meals/time";
import {
  activityPoints,
  byDay,
  cardioMinutes,
  currentStreak,
  dayPoints,
  earnedBadges,
  levelOf,
  levelThreshold,
  stepPoints,
  sweatMinutes,
  weekRows,
  type ScoredActivity,
} from "@/lib/move/score";

const timed = (
  localDate: string,
  category: ActivityCategory,
  durationMin: number,
  intensity: Intensity | null = "moderate",
): ScoredActivity => ({
  localDate,
  category,
  durationMin,
  intensity,
  steps: null,
  stepsOnly: false,
});

const steps = (localDate: string, count: number): ScoredActivity => ({
  localDate,
  category: "walking",
  durationMin: null,
  intensity: null,
  steps: count,
  stepsOnly: true,
});

describe("points and levels", () => {
  it("counts minutes by effort, steps per thousand with a cap, and strength sessions", () => {
    expect(activityPoints(timed("2026-11-10", "cardio", 30, "moderate"))).toBe(30);
    expect(activityPoints(timed("2026-11-10", "cardio", 30, "vigorous"))).toBe(60);
    expect(activityPoints(timed("2026-11-10", "mobility", 25, "light"))).toBe(12);
    expect(activityPoints(steps("2026-11-10", 9000))).toBe(0);
    expect(stepPoints(6240)).toBe(30);
    expect(stepPoints(40_000)).toBe(75);
    // 45 min strength (45 + 15) and 6,240 steps (30).
    expect(dayPoints([timed("2026-11-10", "strength", 45), steps("2026-11-10", 6240)])).toBe(90);
    // Two sources of the same day's steps: the higher one counts, once.
    expect(dayPoints([steps("2026-11-10", 6000), steps("2026-11-10", 4000)])).toBe(30);
    // Strength bonus for two sessions a day at most.
    expect(dayPoints([1, 2, 3].map(() => timed("2026-11-10", "strength", 10)))).toBe(30 + 30);
  });

  it("has rising level thresholds", () => {
    expect([1, 2, 3, 4, 5, 6].map(levelThreshold)).toEqual([0, 150, 450, 900, 1500, 2250]);
    expect(levelOf(0)).toEqual({ level: 1, levelStart: 0, nextLevelAt: 150 });
    expect(levelOf(1240)).toEqual({ level: 4, levelStart: 900, nextLevelAt: 1500 });
    expect(levelOf(1500).level).toBe(5);
  });
});

describe("the streak", () => {
  const today = "2026-11-10";
  const day = (n: number) => shiftLocalDate(today, -n);

  it("counts active days in a row up to today, or up to yesterday while today is not done", () => {
    const days = byDay([
      timed(day(0), "cardio", 20),
      steps(day(1), 5000),
      timed(day(2), "strength", 45),
      timed(day(3), "cardio", 10),
      timed(day(4), "cardio", 60),
    ]);
    expect(currentStreak(days, today)).toBe(3);
    const notYet = byDay([steps(day(1), 7000), steps(day(2), 7000), steps(day(0), 1200)]);
    expect(currentStreak(notYet, today)).toBe(2);
    expect(currentStreak(byDay([steps(day(2), 9000)]), today)).toBe(0);
  });
});

describe("the week by category", () => {
  it("counts cardio as WHO moderate-equivalent minutes, strength days and steps", () => {
    const monday = "2026-11-09";
    const days = byDay([
      timed("2026-11-09", "cardio", 30, "vigorous"),
      timed("2026-11-10", "walking", 30, "moderate"),
      timed("2026-11-10", "walking", 20, "light"),
      timed("2026-11-11", "sports", 30, "moderate"),
      timed("2026-11-10", "strength", 45),
      timed("2026-11-12", "strength", 40),
      timed("2026-11-12", "strength", 20),
      timed("2026-11-13", "mobility", 20, "light"),
      steps("2026-11-09", 8000),
      steps("2026-11-10", 6000),
      // Last week and next week do not count.
      timed("2026-11-08", "cardio", 300),
      steps("2026-11-16", 20_000),
    ]);
    expect(weekRows(days, monday)).toEqual([
      { category: "cardio", value: 120, target: 150, unit: "min" },
      { category: "strength", value: 2, target: 2, unit: "days" },
      { category: "walking", value: 14_000, target: 49_000, unit: "steps" },
      { category: "mobility", value: 20, target: 60, unit: "min" },
      { category: "sports", value: 30, target: null, unit: "min" },
    ]);
    expect(cardioMinutes([timed("2026-11-09", "strength", 60)])).toBe(0);
    expect(
      sweatMinutes([
        timed("2026-11-09", "cardio", 30),
        timed("2026-11-09", "mobility", 20, "light"),
      ]),
    ).toBe(30);
  });
});

describe("badges", () => {
  it("are earned on the day their condition is first met", () => {
    const start = "2026-09-01";
    const day = (n: number) => shiftLocalDate(start, n);
    const history = Array.from({ length: 12 }, (_, i) => ({
      date: day(i),
      activities: [
        ...(i < 8 ? [steps(day(i), i === 5 ? 10_500 : 6000)] : []),
        ...(i === 1 || i === 3 ? [timed(day(i), "strength", 40)] : []),
        ...(i >= 7 && i <= 9 ? [timed(day(i), "cardio", 50, "moderate")] : []),
      ],
      waterGoalMet: i >= 2 && i <= 4,
    }));
    const earned = earnedBadges(history);
    expect(Object.fromEntries(earned)).toEqual({
      first_workout: day(1),
      strength_2: day(3),
      streak_3: day(2),
      streak_7: day(6),
      steps_10k: day(5),
      water_3: day(4),
      // 50 minutes of cardio on days 7 to 9, all in the week of Monday 7 September.
      week_150: day(9),
    });
    expect(earned.has("streak_30")).toBe(false);
    expect(earned.has("workouts_10")).toBe(false);
  });

  it("counts workouts across days and breaks a streak on a missing day", () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      date: shiftLocalDate("2026-10-01", i * 2),
      activities: [timed(shiftLocalDate("2026-10-01", i * 2), "cardio", 25)],
      waterGoalMet: true,
    }));
    const earned = earnedBadges(history);
    expect(earned.get("workouts_10")).toBe("2026-10-19");
    expect(earned.has("streak_3")).toBe(false);
    expect(earned.has("water_3")).toBe(false);
  });
});
