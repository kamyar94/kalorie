// Activities as plain logic: "+ Activity" input checks, imported records, the category a workout's
// name points to, the MET and energy estimate, and the week Move counts.
import { describe, expect, it } from "vitest";

import { parseImportedActivity, parseManualActivity } from "@/lib/activities/parse";
import {
  categoryFromWords,
  energyEstimate,
  formatMinutes,
  metOf,
} from "@/lib/contracts/activities";
import { weekDays, weekLabel, weekStart } from "@/lib/move/week";

const NOW = Date.parse("2026-11-10T12:00:00Z");

describe("+ Activity input", () => {
  const base = { type: "run", startedAt: "2026-11-10T07:00:00Z", tz: "Europe/Berlin" };

  it("needs a known type, a time in the last year and a duration", () => {
    expect(parseManualActivity({ ...base, type: "flying" }, NOW)).toEqual({
      error: "Choose what you did.",
    });
    expect(parseManualActivity({ ...base, startedAt: "2026-11-11T07:00:00Z" }, NOW)).toEqual({
      error: "Choose a time in the last year, not in the future.",
    });
    expect(parseManualActivity({ ...base, tz: "Mars/Base" }, NOW)).toEqual({
      error: "The time zone is not valid.",
    });
    expect(parseManualActivity(base, NOW)).toEqual({
      error: "Write how long it took, in minutes.",
    });
  });

  it("keeps the type's own effort unless one is chosen, and steps for a day's total", () => {
    expect(parseManualActivity({ ...base, durationMin: 30.4, distanceKm: 5.123 }, NOW)).toEqual({
      ...base,
      startedAt: "2026-11-10T07:00:00.000Z",
      title: null,
      notes: null,
      durationMin: 30,
      intensity: "vigorous",
      distanceKm: 5.12,
    });
    expect(
      parseManualActivity(
        { ...base, durationMin: 30, intensity: "light", title: "  Easy  run " },
        NOW,
      ),
    ).toMatchObject({ intensity: "light", title: "Easy run" });
    expect(parseManualActivity({ ...base, type: "steps" }, NOW)).toEqual({
      error: "Write how many steps.",
    });
    expect(parseManualActivity({ ...base, type: "steps", steps: 8900.4 }, NOW)).toMatchObject({
      type: "steps",
      steps: 8900,
    });
  });
});

describe("imported records", () => {
  const record = {
    externalId: "samsung:steps:2026-11-09",
    sourceApp: "samsung-health",
    category: "walking",
    type: "steps",
    title: "Steps",
    startedAt: "2026-11-09T11:00:00Z",
    tz: "UTC",
    localDate: "2026-11-09",
    steps: 8900,
  };

  it("keeps a valid record and drops unknown fields", () => {
    expect(parseImportedActivity({ ...record, extra: "x" }, NOW)).toMatchObject({
      externalId: record.externalId,
      steps: 8900,
      durationMin: null,
    });
  });

  it("skips records without an id, an app, a category, a time, or a duration and steps", () => {
    expect(parseImportedActivity({ ...record, externalId: "" }, NOW)).toBeNull();
    expect(parseImportedActivity({ ...record, externalId: "a b" }, NOW)).toBeNull();
    expect(parseImportedActivity({ ...record, sourceApp: "Samsung Health" }, NOW)).toBeNull();
    expect(parseImportedActivity({ ...record, category: "flying" }, NOW)).toBeNull();
    expect(parseImportedActivity({ ...record, startedAt: "2030-01-01T00:00:00Z" }, NOW)).toBeNull();
    expect(parseImportedActivity({ ...record, steps: 0 }, NOW)).toBeNull();
    expect(parseImportedActivity(null, NOW)).toBeNull();
  });
});

describe("categories, METs and energy", () => {
  it("reads a category from a workout's name, strength unless it says otherwise", () => {
    expect(categoryFromWords("Legs Squat Sled push")).toBe("strength");
    expect(categoryFromWords("Morning yoga")).toBe("mobility");
    expect(categoryFromWords("Rowing intervals")).toBe("cardio");
    expect(categoryFromWords("Evening walk")).toBe("walking");
    expect(categoryFromWords("Tennis with friends")).toBe("sports");
    expect(categoryFromWords("Gardening", "other")).toBe("other");
  });

  it("uses 3.5 METs for resistance training and the WHO band middles otherwise", () => {
    expect(metOf("strength", "moderate")).toBe(3.5);
    expect(metOf("strength", "vigorous")).toBe(8);
    expect(metOf("cardio", "light")).toBe(2.5);
    expect(metOf("cardio", null)).toBe(4.5);
    // 3.5 MET x 80 kg x 0.75 h
    expect(energyEstimate(3.5, 80, 45)).toBe(210);
    expect(energyEstimate(3.5, null, 45)).toBeNull();
    expect(energyEstimate(3.5, 80, 0)).toBeNull();
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(65)).toBe("1 h 5 min");
    expect(formatMinutes(120)).toBe("2 h");
  });
});

describe("weeks", () => {
  it("run Monday to Sunday", () => {
    expect(weekStart("2026-11-10")).toBe("2026-11-09");
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
    expect(weekDays("2026-11-09").at(-1)).toBe("2026-11-15");
    expect(weekLabel("2026-11-09")).toBe("9 to 15 November");
    expect(weekLabel("2026-11-30")).toBe("30 November to 6 December");
  });
});
