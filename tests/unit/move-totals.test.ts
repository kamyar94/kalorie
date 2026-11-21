// Move's day with the phone's steps, active time and activity calories (board 39), "Every day"
// (board 40) and Today's card, as plain logic: the source line, the rings' words, what a day
// without them says, the note when the last update is old, and the rows. Values are made up.
import { describe, expect, it } from "vitest";

import { DEFAULT_MOVE_GOALS, type DayTotalDto, type MoveDayDto } from "@/lib/contracts/move";
import {
  everyDayLabel,
  goalCaption,
  isEmptyRow,
  isStale,
  kalWorkoutsText,
  noTotalsNote,
  ringLabel,
  ringValue,
  todayTiles,
  totalsSourceLine,
  type Segment,
} from "@/lib/move/words";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const TODAY = "2026-11-10";
const SAMSUNG = "com.sec.android.app.shealth";
const PHONE = "com.android.healthconnect.phone.0a1b2c3d";
const FIT = "com.google.android.apps.fitness";

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

const text = (parts: Segment[]) => parts.map((p) => (p.bold ? `**${p.text}**` : p.text)).join("");

describe("Move's day with the phone's numbers (board 39)", () => {
  it("names where the numbers came from, and when the phone last sent", () => {
    expect(text(totalsSourceLine(total(), "10:56"))).toBe(
      "From Health Connect: **Samsung Health**. Last update from your phone 10:56; Samsung Health may already show more until the next one.",
    );
    expect(text(totalsSourceLine(total(), null))).toBe("From Health Connect: **Samsung Health**.");
    expect(
      text(
        totalsSourceLine(
          total({ stepsApp: PHONE, activeApp: PHONE, kcalApp: FIT }),
          "yesterday 21:05",
        ),
      ),
    ).toBe(
      "From Health Connect: **Phone** (Android's step counter; steps and active time) and **Google Fit** (activity calories). Last update from your phone yesterday 21:05; Health Connect may already hold more until the next one.",
    );
    expect(
      text(totalsSourceLine(total({ stepsApp: SAMSUNG, activeApp: PHONE, kcalApp: FIT }), null)),
    ).toBe(
      "From Health Connect: **Samsung Health** (steps), **Phone** (Android's step counter; active time) and **Google Fit** (activity calories).",
    );
    // A number at 0 names no app.
    expect(text(totalsSourceLine(total({ activeKcal: 0, kcalApp: FIT }), null))).toBe(
      "From Health Connect: **Samsung Health**.",
    );
    expect(
      text(totalsSourceLine(total({ stepsApp: null, activeApp: null, kcalApp: null }), null)),
    ).toBe("From Health Connect.");
  });

  it("puts each number in its ring with its goal, and says it", () => {
    expect(ringValue("steps", 8412)).toEqual({ value: "8,412", unit: "steps" });
    expect(ringValue("activeMinutes", 54)).toEqual({ value: "54", unit: "min" });
    expect(ringValue("activeMinutes", 72)).toEqual({ value: "1 h 12", unit: "min" });
    expect(ringValue("activeMinutes", 120)).toEqual({ value: "2 h", unit: "active" });
    expect(ringValue("activeKcal", 486.4)).toEqual({ value: "486", unit: "kcal" });
    expect(ringValue("activeKcal", null)).toEqual({ value: "–", unit: "kcal" });
    expect(goalCaption("steps", 7000)).toBe("goal 7,000");
    expect(goalCaption("activeMinutes", 60)).toBe("goal 1 h");
    expect(goalCaption("activeMinutes", 45)).toBe("goal 45 min");
    expect(goalCaption("activeKcal", 500)).toBe("goal 500 kcal");
    expect(ringLabel("steps", 8412, 7000)).toBe("Steps: 8,412 of 7,000, goal reached");
    expect(ringLabel("activeMinutes", 54, 60)).toBe("Active time: 54 min of 1 h");
    expect(ringLabel("activeMinutes", 60, 60)).toBe("Active time: 1 h of 1 h, goal reached");
    expect(ringLabel("activeKcal", 486, 500)).toBe("Activity calories: 486 of 500 kcal");
    expect(ringLabel("activeKcal", null, 500)).toBe("Activity calories: no number from the phone");
  });

  it("asks for app 1.2 on a day without the phone's numbers, by the phone the person has", () => {
    expect(noTotalsNote("old")).toEqual({
      text: "Active time and activity calories come with Kal for Android 1.2. Update the app on your phone to see them here.",
      link: "Update Kal for Android",
    });
    expect(noTotalsNote("current").link).toBeNull();
    expect(noTotalsNote("none").link).toBe("Kal for Android");
  });

  it("calls out a last update more than two hours old for the day it may miss", () => {
    const zone = "Europe/Berlin";
    const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
    const at = { today: TODAY, zone, now: NOW };
    expect(isStale({ ...at, lastUpdate: null, date: TODAY })).toBe(false);
    expect(isStale({ ...at, lastUpdate: ago(1.9), date: TODAY })).toBe(false);
    expect(isStale({ ...at, lastUpdate: ago(2.1), date: TODAY })).toBe(true);
    // Sent at 21:00 yesterday (Berlin): yesterday may miss its last hours, the day before not.
    const lastNight = "2026-11-09T20:00:00.000Z";
    expect(isStale({ ...at, lastUpdate: lastNight, date: "2026-11-09" })).toBe(true);
    expect(isStale({ ...at, lastUpdate: lastNight, date: "2026-11-08" })).toBe(false);
  });

  it("writes Kal's workouts next to the phone's numbers", () => {
    expect(kalWorkoutsText({ workouts: 2, activeMinutes: 46, energyKcal: null })).toBe(
      "2 · 46 min",
    );
    expect(kalWorkoutsText({ workouts: 1, activeMinutes: 30, energyKcal: 212 })).toBe(
      "1 · 30 min · 212 kcal",
    );
    expect(kalWorkoutsText({ workouts: 0, activeMinutes: 0, energyKcal: null })).toBe("None");
  });
});

describe("every day (board 40) and Today's card", () => {
  it("labels the rows and knows an empty day", () => {
    expect(everyDayLabel(TODAY, TODAY)).toBe("Today, Tue 10");
    expect(everyDayLabel("2026-11-08", TODAY)).toBe("Sun 8");
    const empty = { date: TODAY, steps: null, activeMinutes: null, activeKcal: null };
    expect(isEmptyRow({ ...empty, fromPhone: false })).toBe(true);
    expect(isEmptyRow({ ...empty, fromPhone: true })).toBe(false);
    expect(isEmptyRow({ ...empty, steps: 310, fromPhone: false })).toBe(false);
  });

  it("shows the phone's three numbers on Today's card, else Move's", () => {
    const day: MoveDayDto = {
      activeMinutes: 45,
      activeLabel: "Strength, openGym",
      steps: 6240,
      stepsSource: "Samsung Health",
      stepsFrom: { source: "health_connect", sourceApp: SAMSUNG },
      points: 90,
      sweatMinutes: 45,
      energyKcal: 212,
      totals: total({ steps: 6240 }),
      goals: DEFAULT_MOVE_GOALS,
    };
    expect(todayTiles(day, "10:56")).toEqual({
      steps: { value: "6,240", caption: "Steps · Samsung Health, updated 10:56" },
      active: { value: "1 h 11 min", caption: "Active time · phone" },
      kcal: { value: "455", caption: "Activity kcal · phone" },
    });
    const without = todayTiles(
      {
        ...day,
        totals: null,
        stepsSource: "imported",
        stepsFrom: { source: "import", sourceApp: null },
      },
      null,
    );
    expect(without).toEqual({
      steps: { value: "6,240", caption: "Steps · imported" },
      active: { value: "45 min", caption: "Strength, openGym" },
      kcal: { value: "212", caption: "Activity kcal" },
    });
    const unknown = todayTiles(
      { ...day, totals: total({ activeMinutes: null, activeKcal: null }) },
      null,
    );
    expect([unknown.active.value, unknown.kcal.value]).toEqual(["–", "–"]);
  });
});
