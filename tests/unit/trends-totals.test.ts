// Trends and Your year with the phone's day totals (Kal for Android 1.2) as plain logic: the
// phone's active time and activity calories win where it sent them, Move's rules elsewhere, and
// the year compares active minutes with the active time goal. Values are made up.
import { describe, expect, it } from "vitest";

import type { DayTotalDto } from "@/lib/contracts/move";
import { shiftLocalDate } from "@/lib/meals/time";
import { activityDay, computeActivityTrends, phoneCaption } from "@/lib/trends/activity";
import { amountOf, ACTIVE_MINUTES_A_DAY, yearTarget, type YearDay } from "@/lib/trends/year";

const TODAY = "2026-11-10";
const SAMSUNG = "com.sec.android.app.shealth";

const total = (over: Partial<DayTotalDto> = {}): DayTotalDto => ({
  date: TODAY,
  steps: 8123,
  stepsApp: SAMSUNG,
  activeMinutes: 71,
  activeMethod: "sessions+steps60",
  activeApp: SAMSUNG,
  activeKcal: 455,
  kcalApp: SAMSUNG,
  updatedAt: "2026-11-10T09:30:00.000Z",
  ...over,
});

describe("Trends and the year with the phone's numbers", () => {
  it("takes the phone's active time and calories where it sent them, Move's rules elsewhere", () => {
    const run = {
      localDate: TODAY,
      category: "cardio" as const,
      durationMin: 30,
      intensity: "moderate" as const,
      steps: null,
      stepsOnly: false,
      energyKcal: 250,
    };
    const day = activityDay(TODAY, [run], total());
    expect(day).toMatchObject({
      logged: true,
      fromPhone: true,
      steps: 8123,
      activeMinutes: 71,
      energyKcal: 455,
      workouts: 1,
    });
    expect(day.minutes.cardio).toBe(30);
    // Without the phone's number for one of them, Kal's counts.
    expect(activityDay(TODAY, [run], total({ activeMinutes: null })).activeMinutes).toBe(30);
    expect(activityDay(TODAY, [run], null)).toMatchObject({
      fromPhone: false,
      activeMinutes: 30,
      energyKcal: 250,
    });
    // A day with only the phone's numbers is a day with data.
    expect(activityDay(TODAY, [], total())).toMatchObject({ logged: true, steps: 8123 });

    const end = TODAY;
    const trends = computeActivityTrends({
      range: "week",
      end,
      activities: [run],
      dayTotals: [total({ date: shiftLocalDate(end, -1), activeMinutes: 50, activeKcal: 300 })],
      goals: { steps: 9000, activeMinutes: 45, activeKcal: 400 },
    });
    expect(trends.stepGoal).toBe(9000);
    expect(trends.goals.activeMinutes).toBe(45);
    expect(trends.phoneDays).toBe(1);
    expect(trends.averageMinutes).toBe((30 + 50) / 2);
    expect(trends.averageEnergy).toBe((250 + 300) / 2);
    expect(phoneCaption(trends)).toBe(
      "Active time and activity calories are the phone's on 1 of 7 days (Kal for Android); on the others they come from your activities in Kal.",
    );
    expect(phoneCaption({ ...trends, phoneDays: 0 })).toBeNull();
    expect(phoneCaption({ ...trends, phoneDays: 7 })).toBe(
      "Active time and activity calories are the phone's on every day (Kal for Android).",
    );
  });

  it("uses the phone's numbers for the year's active minutes and energy, and their goal", () => {
    const base: YearDay = {
      date: TODAY,
      meals: 0,
      value: null,
      energy: null,
      protein: null,
      carbs: null,
      fat: null,
      waterMl: 0,
      waterGoalMl: 2000,
      steps: 0,
      activity: true,
      activeMinutes: 30,
      whoMinutes: 40,
      workouts: 1,
      activityEnergy: 250,
      phoneMinutes: null,
      phoneKcal: null,
    };
    expect(amountOf(base, "active_minutes")).toBe(40);
    expect(amountOf(base, "activity_energy")).toBe(250);
    const phone = { ...base, phoneMinutes: 71, phoneKcal: 455 };
    expect(amountOf(phone, "active_minutes")).toBe(71);
    expect(amountOf(phone, "activity_energy")).toBe(455);
    expect(yearTarget("active_minutes", {}, 2000)).toEqual({
      kind: "more",
      target: ACTIVE_MINUTES_A_DAY,
      upper: null,
    });
    expect(yearTarget("active_minutes", {}, 2000, 7000, 60)).toEqual({
      kind: "more",
      target: 60,
      upper: null,
    });
    expect(yearTarget("steps", {}, 2000, 9000, 60)).toEqual({
      kind: "more",
      target: 9000,
      upper: null,
    });
  });
});
