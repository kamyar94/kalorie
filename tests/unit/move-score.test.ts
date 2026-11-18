// Move's rules (lib/move/score.ts): points, levels, the streak, the week by category against the
// WHO targets, and the day each badge is earned.
import { describe, expect, it } from "vitest";

import type { ActivityCategory, Intensity } from "@/lib/contracts/activities";
import { shiftLocalDate } from "@/lib/meals/time";
import type { ActivityDto } from "@/lib/contracts/activities";
import {
  activityPoints,
  byDay,
  cardioMinutes,
  countedSteps,
  currentStreak,
  dayPoints,
  daySteps,
  earnedBadges,
  isStepsOnly,
  levelOf,
  levelThreshold,
  pointsOfEach,
  stepPoints,
  sweatMinutes,
  weekRows,
  type ScoredActivity,
} from "@/lib/move/score";
import { activityWaterMl, dayWaterGoalMl } from "@/lib/move/water";
import {
  dayActivityCaption,
  moveDayTitle,
  stepsFromLine,
  stripDay,
  stripLabel,
} from "@/lib/move/words";

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
    // Health Connect's day total wins, even when another source counted more.
    expect(
      daySteps([
        steps("2026-11-10", 12_000),
        { ...steps("2026-11-10", 8412), source: "health_connect" },
        { ...steps("2026-11-10", 300), source: "manual" },
      ]),
    ).toBe(8412);
    expect(daySteps([steps("2026-11-10", 3000), timed("2026-11-10", "cardio", 20)])).toBe(3000);
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

describe("water for activity", () => {
  it("adds about 0.5 L an hour of moderate or harder activity, in 0.1 L steps, at most 1.5 L", () => {
    expect(activityWaterMl(0)).toBe(0);
    expect(activityWaterMl(5)).toBe(0);
    expect(activityWaterMl(10)).toBe(100);
    expect(activityWaterMl(45)).toBe(400);
    expect(activityWaterMl(60)).toBe(500);
    expect(activityWaterMl(400)).toBe(1500);
    expect(dayWaterGoalMl(2000, 45)).toBe(2400);
  });
});

describe("one day on Move", () => {
  const at = (time: string) => `2026-11-17T${time}:00.000Z`;
  const run = { ...timed("2026-11-17", "cardio", 28, "vigorous"), startedAt: at("07:10") };
  const lift = (time: string) => ({ ...timed("2026-11-17", "strength", 10), startedAt: at(time) });
  const count = (n: number, source: ScoredActivity["source"]) => ({
    ...steps("2026-11-17", n),
    source,
    startedAt: at("12:00"),
  });

  it("splits the day's points over its activities, adding up to the day's", () => {
    const phone = count(4150, "health_connect");
    const imported = count(9000, "import");
    const day = [lift("18:30"), run, lift("07:00"), lift("12:00"), imported, phone];
    // The strength bonus goes to the first two sessions by start; steps to Health Connect's.
    expect(pointsOfEach(day)).toEqual([10, 56, 25, 25, 0, 20]);
    expect(pointsOfEach(day).reduce((a, b) => a + b, 0)).toBe(dayPoints(day));
    expect(countedSteps(day)).toBe(phone);
    expect(countedSteps([imported, count(9000, "manual")])).toBe(imported);
    expect(countedSteps([run])).toBeNull();
  });

  it("knows a step count from a timed activity", () => {
    expect(isStepsOnly({ type: "steps", durationMin: null, steps: 4000 })).toBe(true);
    expect(isStepsOnly({ type: "walk", durationMin: null, steps: 4000 })).toBe(true);
    expect(isStepsOnly({ type: "walk", durationMin: 30, steps: 4000 })).toBe(false);
    expect(isStepsOnly({ type: "run", durationMin: 30, steps: null })).toBe(false);
  });

  it("names the day and the days of the week strip", () => {
    expect(moveDayTitle("2026-11-18", "2026-11-18")).toBe("Today, Wednesday 18 November");
    expect(moveDayTitle("2026-11-17", "2026-11-18")).toBe("Yesterday, Tuesday 17 November");
    expect(moveDayTitle("2026-11-16", "2026-11-18")).toBe("Monday 16 November");
    expect(moveDayTitle("2025-12-31", "2026-01-02")).toBe("Wednesday 31 December 2025");
    expect(stripDay("2026-11-16")).toEqual({ weekday: "Mon", day: "16" });
    expect(stripLabel({ date: "2026-11-16", steps: 4701, future: false }, 7000)).toBe(
      "Mon 16 November, 4,701 steps",
    );
    expect(stripLabel({ date: "2026-11-18", steps: 7480, future: false }, 7000)).toBe(
      "Wed 18 November, 7,480 steps, goal reached",
    );
    expect(stripLabel({ date: "2026-11-19", steps: 0, future: true }, 7000)).toBe(
      "Thu 19 November, still to come",
    );
  });

  it("says where the steps came from and when a phone last sent", () => {
    const phone = "com.android.healthconnect.phone.0a1b2c3d";
    const words = (line: ReturnType<typeof stepsFromLine>) =>
      `${line.before}${line.name ? `[${line.name}]` : ""}${line.after}`;
    const from = (source: ScoredActivity["source"] & string, sourceApp: string | null) => ({
      steps: 4150,
      stepsFrom: { source, sourceApp },
    });
    expect(words(stepsFromLine(from("health_connect", phone), "23:04"))).toBe(
      "Steps from Health Connect: [Phone] (Android's step counter). Updated 23:04.",
    );
    expect(words(stepsFromLine(from("health_connect", "com.sec.android.app.shealth"), null))).toBe(
      "Steps from Health Connect: [Samsung Health].",
    );
    expect(words(stepsFromLine(from("health_connect", null), "yesterday 21:05"))).toBe(
      "Steps from Health Connect (several apps). Updated yesterday 21:05.",
    );
    expect(words(stepsFromLine(from("import", "samsung-health"), "23:04"))).toBe(
      "Steps imported from [Samsung Health].",
    );
    expect(words(stepsFromLine(from("manual", null), "23:04"))).toBe("Steps typed in Kal.");
    expect(words(stepsFromLine({ steps: 0, stepsFrom: null }, null))).toBe(
      "No steps for this day.",
    );
    expect(words(stepsFromLine({ steps: 0, stepsFrom: null }, "23:04"))).toBe(
      "No steps from Health Connect for this day. A phone last sent an update 23:04.",
    );
  });

  it("captions an activity of the day", () => {
    const base: ActivityDto = {
      id: "a",
      category: "cardio",
      type: "run",
      title: "Run",
      startedAt: at("07:10"),
      tz: "UTC",
      localDate: "2026-11-17",
      localTime: "07:10",
      durationMin: 28,
      distanceM: 4120,
      steps: null,
      energyKcal: 299,
      intensity: "vigorous",
      source: "health_connect",
      sourceApp: "com.sec.android.app.shealth",
      notes: null,
    };
    expect(dayActivityCaption(base)).toBe("07:10 · 28 min · 4.1 km · Samsung Health");
    expect(dayActivityCaption({ ...base, distanceM: null, source: "opengym" })).toBe(
      "07:10 · 28 min · openGym",
    );
    expect(
      dayActivityCaption({
        ...base,
        type: "steps",
        durationMin: null,
        distanceM: null,
        steps: 4150,
        sourceApp: "com.android.healthconnect.phone.0a1b2c3d",
      }),
    ).toBe("4,150 steps · day total · Phone");
    expect(dayActivityCaption({ ...base, source: "manual", sourceApp: null })).toBe(
      "07:10 · 28 min · 4.1 km · typed in Kal",
    );
  });
});
