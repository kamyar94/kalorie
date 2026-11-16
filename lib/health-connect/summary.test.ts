// The words of "Recent updates" and the "Nothing has arrived yet" warning (board 34).
import { describe, expect, it } from "vitest";

import type { HcUpdateCounts } from "@/lib/contracts/health-connect";

import { nothingArrivedText, summaryText, updateSummary } from "./summary";

const counts = (over: Partial<HcUpdateCounts> = {}): HcUpdateCounts => ({
  firstReadDays: null,
  stepDays: 0,
  stepDaysZero: 0,
  stepsToday: null,
  workouts: 0,
  restingDays: 0,
  sleepSessions: 0,
  bodyRecords: 0,
  weighIns: 0,
  height: false,
  deleted: 0,
  skipped: 0,
  added: 0,
  written: 0,
  removed: 0,
  empty: true,
  ...over,
});

const line = (over: Partial<HcUpdateCounts>, sameDay = true) =>
  summaryText(updateSummary(counts(over), sameDay));

describe("updateSummary", () => {
  it("says what arrived, with today's steps first", () => {
    const summary = updateSummary(
      counts({ stepDays: 2, stepsToday: 6812, workouts: 1, bodyRecords: 5, weighIns: 1 }),
      true,
    );
    expect(summary.tone).toBe("content");
    expect(summary.parts.map((p) => p.emoji)).toEqual(["👟", "🏋️", "⚖️"]);
    expect(summaryText(summary)).toBe("6,812 steps today · 1 workout · 1 weigh-in");
    expect(line({ stepDays: 1, stepsToday: 12_040 }, false)).toBe("12,040 steps that day");
  });

  it("counts days and nights when there is no step total for the day", () => {
    expect(
      line({ stepDays: 1, restingDays: 2, sleepSessions: 1, bodyRecords: 3, height: true }),
    ).toBe(
      "1 day of steps · 2 days of resting heart rate · 1 night of sleep · 3 body values · height",
    );
    expect(line({ workouts: 2, sleepSessions: 2 })).toBe("2 workouts · 2 nights of sleep");
  });

  it("names a read of the whole window, empty or not", () => {
    const empty = updateSummary(counts({ firstReadDays: 30 }), true);
    expect(empty).toEqual({
      lead: "First read, 30 days: Health Connect was empty",
      parts: [],
      tone: "empty-read",
    });
    expect(
      line({
        firstReadDays: 365,
        stepDays: 24,
        stepsToday: 900,
        workouts: 3,
        weighIns: 12,
        bodyRecords: 40,
      }),
    ).toBe("First read, 365 days: 24 days of steps · 3 workouts · 12 weigh-ins");
  });

  it("says nothing new for an update with nothing to store", () => {
    expect(updateSummary(counts({ stepDaysZero: 2 }), true)).toEqual({
      lead: "Nothing new",
      parts: [],
      tone: "nothing",
    });
    const skipped = updateSummary(counts({ skipped: 2 }), true);
    expect(skipped.tone).toBe("nothing");
    expect(summaryText(skipped)).toBe("2 records left out");
  });

  it("names deletions and records left out", () => {
    expect(line({ deleted: 3 })).toBe("3 removed in Health Connect");
    expect(updateSummary(counts({ deleted: 3 }), true).tone).toBe("content");
    expect(line({ stepDays: 1, stepsToday: 50, skipped: 1 })).toBe(
      "50 steps today · 1 record left out",
    );
  });
});

describe("nothingArrivedText", () => {
  it("counts the updates, or says the phone sent some before the log existed", () => {
    expect(nothingArrivedText(3)).toMatch(/^The phone sent 3 updates, but Health Connect had no/);
    expect(nothingArrivedText(1)).toMatch(/^The phone sent 1 update, but/);
    expect(nothingArrivedText(0)).toMatch(/^The phone has sent updates, but/);
    expect(nothingArrivedText(2)).toContain(
      "Usually Samsung Health or the Renpho app is not sharing with Health Connect yet.",
    );
  });
});
