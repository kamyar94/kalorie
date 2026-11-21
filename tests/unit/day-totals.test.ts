// The phone's day totals (Kal for Android 1.2) as plain logic: the batch checks, what the update
// log counts, and which app versions send them. Values are made up.
import { describe, expect, it } from "vitest";

import { sendsDayTotals } from "@/lib/contracts/devices";
import { isEmptyDayTotal } from "@/lib/contracts/health-connect";
import { countBatch } from "@/lib/health-connect/log";
import { parseSyncBatch, TOO_MANY_RECORDS, type CheckedBatch } from "@/lib/health-connect/parse";
import { shiftLocalDate } from "@/lib/meals/time";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const TODAY = "2026-11-10";
const SAMSUNG = "com.sec.android.app.shealth";

describe("the batch's day totals", () => {
  const base = { tz: "Europe/Berlin", appVersion: "1.2 (3)" };

  it("keeps usable days and leaves out odd ones, counting them as skipped", () => {
    const parsed = parseSyncBatch(
      {
        ...base,
        dayTotals: [
          {
            date: TODAY,
            steps: 8123,
            stepsApp: SAMSUNG,
            activeMinutes: 71,
            activeMethod: "sessions+steps60",
            activeApp: SAMSUNG,
            activeKcal: 455.4,
            kcalApp: SAMSUNG,
          },
          // A clock change gives 25 hours: 1,500 minutes is fine, 1,501 is not.
          { date: shiftLocalDate(TODAY, -1), activeMinutes: 1500 },
          { date: shiftLocalDate(TODAY, -2), activeMinutes: 1501 },
          { date: shiftLocalDate(TODAY, -3), steps: -1 },
          { date: shiftLocalDate(TODAY, -4), activeMethod: "Not A Method" },
          { date: shiftLocalDate(TODAY, -5), activeKcal: 25_000 },
          { date: shiftLocalDate(TODAY, -6), stepsApp: "not a package!" },
          { date: "2026-13-01" },
          // More than three years ago, or more than a day ahead.
          { date: shiftLocalDate(TODAY, -1200), steps: 10 },
          { date: shiftLocalDate(TODAY, 2), steps: 10 },
        ],
      },
      NOW,
    );
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.skipped).toBe(8);
    expect(parsed.batch.dayTotals).toEqual([
      {
        date: TODAY,
        steps: 8123,
        stepsApp: SAMSUNG,
        activeMinutes: 71,
        activeMethod: "sessions+steps60",
        activeApp: SAMSUNG,
        activeKcal: 455.4,
        kcalApp: SAMSUNG,
      },
      { date: shiftLocalDate(TODAY, -1), activeMinutes: 1500 },
    ]);
  });

  it("is optional (apps 1.0 and 1.1), must be a list, and counts towards the record limit", () => {
    const old = parseSyncBatch({ ...base, appVersion: "1.1 (2)", steps: [] }, NOW);
    expect("error" in old ? old.error : old.batch.dayTotals).toEqual([]);
    const notList = parseSyncBatch({ ...base, dayTotals: { date: TODAY } }, NOW);
    expect(notList).toMatchObject({ tooLarge: false });
    const many = parseSyncBatch(
      {
        ...base,
        steps: Array.from({ length: 1500 }, () => ({ date: TODAY, count: 1 })),
        dayTotals: Array.from({ length: 501 }, () => ({ date: TODAY })),
      },
      NOW,
    );
    expect(many).toEqual({ error: TOO_MANY_RECORDS, tooLarge: true });
  });

  it("counts the days with a number in the update log; empty ones store nothing", () => {
    const batch = (dayTotals: CheckedBatch["dayTotals"]): CheckedBatch => ({
      tz: "UTC",
      appVersion: "1.2 (3)",
      steps: [],
      workouts: [],
      body: [],
      height: null,
      restingHeartRate: [],
      sleep: [],
      deleted: [],
      firstReadDays: null,
      dayTotals,
    });
    expect(countBatch(batch([]), new Date(NOW))).toMatchObject({ dayTotals: 0, empty: true });
    const counted = countBatch(
      batch([
        { date: TODAY, steps: 0, activeMinutes: 0, activeKcal: 0 },
        { date: shiftLocalDate(TODAY, -1), activeKcal: 12.5 },
        { date: shiftLocalDate(TODAY, -2), activeMinutes: 3 },
      ]),
      new Date(NOW),
    );
    expect(counted).toMatchObject({ dayTotals: 2, empty: false });
    expect(isEmptyDayTotal({ date: TODAY })).toBe(true);
    expect(isEmptyDayTotal({ date: TODAY, steps: null, activeMinutes: 0, activeKcal: 0 })).toBe(
      true,
    );
    expect(isEmptyDayTotal({ date: TODAY, steps: 1 })).toBe(false);
  });

  it("comes from app 1.2 and newer", () => {
    expect(sendsDayTotals("1.2 (3)")).toBe(true);
    expect(sendsDayTotals("1.10 (11)")).toBe(true);
    expect(sendsDayTotals("2.0")).toBe(true);
    expect(sendsDayTotals("1.1 (2)")).toBe(false);
    expect(sendsDayTotals("1.0 (1)")).toBe(false);
    expect(sendsDayTotals(null)).toBe(false);
    expect(sendsDayTotals("beta")).toBe(false);
  });
});
