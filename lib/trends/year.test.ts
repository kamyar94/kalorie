import { describe, expect, it } from "vitest";

import { NUTRIENT_CODES } from "@/lib/contracts/nutrients";
import type { NutrientTarget } from "@/lib/contracts/targets";

import {
  binFor,
  clampYear,
  countsText,
  dayLook,
  dayName,
  formatAmount,
  isYearMetric,
  lastDayOf,
  metricLabel,
  moveInGrid,
  percentOf,
  scaleLevel,
  scaleMax,
  squareLabel,
  targetText,
  targetWords,
  trendsHref,
  YEAR_METRIC_GROUPS,
  YEAR_METRICS,
  yearCounts,
  yearGrid,
  yearTarget,
  type DayLook,
  type LookContext,
  type YearDay,
  type YearTarget,
} from "./year";

const day = (date: string, over: Partial<YearDay> = {}): YearDay => ({
  date,
  meals: 1,
  value: 2000,
  energy: 2000,
  protein: 100,
  carbs: 200,
  fat: 70,
  waterMl: 0,
  waterGoalMl: 1800,
  steps: 0,
  ...over,
});

const row = (
  code: NutrientTarget["code"],
  target: number | null,
  kind: NutrientTarget["kind"],
  upper: number | null = null,
): NutrientTarget => ({ code, target, upper, kind, custom: false, basis: "dri" });

describe("colour bins", () => {
  it.each([
    [0, "far_under"],
    [49, "far_under"],
    [50, "under"],
    [84, "under"],
    [85, "on_target"],
    [100, "on_target"],
    [110, "on_target"],
    [111, "over"],
    [125, "over"],
    [126, "well_over"],
    [150, "well_over"],
    [151, "far_over"],
    [400, "far_over"],
  ])("%i%% is %s", (percent, bin) => {
    expect(binFor(percent)).toBe(bin);
  });

  it("bins the whole percent the summary shows, so colour and number agree", () => {
    expect(percentOf(2208, 2000)).toBe(110); // 110.4 %
    expect(binFor(percentOf(2208, 2000))).toBe("on_target");
    expect(percentOf(2210, 2000)).toBe(111); // 110.5 % rounds up
    expect(binFor(percentOf(2210, 2000))).toBe("over");
    expect(percentOf(1689, 2000)).toBe(84); // 84.45 %
    expect(binFor(percentOf(1689, 2000))).toBe("under");
    expect(percentOf(999, 2000)).toBe(50); // 49.95 %
    expect(binFor(percentOf(999, 2000))).toBe("under");
    expect(binFor(percentOf(989, 2000))).toBe("far_under"); // 49.45 %
  });
});

describe("targets and their words", () => {
  const targets = {
    energy: row("energy", 2100, "goal"),
    protein: row("protein", 150, "min"),
    sodium: row("sodium", 2300, "max"),
    iron: row("iron", 8, "range", 45),
    vit_d: row("vit_d", 0, "min"),
    fat_mono: row("fat_mono", null, "goal"),
  };

  it("reads the metric's target, the water goal for water, and nothing without a target", () => {
    expect(yearTarget("energy", targets, 1800)).toEqual({
      kind: "goal",
      target: 2100,
      upper: null,
    });
    expect(yearTarget("iron", targets, 1800)).toEqual({ kind: "range", target: 8, upper: 45 });
    expect(yearTarget("water", targets, 1800)).toEqual({ kind: "min", target: 1800, upper: null });
    expect(yearTarget("water", targets, 0)).toBeNull();
    expect(yearTarget("vit_d", targets, 1800)).toBeNull();
    expect(yearTarget("fat_mono", targets, 1800)).toBeNull();
    expect(yearTarget("caffeine", targets, 1800)).toBeNull();
  });

  it("shows targets the way the menu lists them", () => {
    expect(targetText("energy", yearTarget("energy", targets, 0))).toBe("2,100 kcal");
    expect(targetText("protein", yearTarget("protein", targets, 0))).toBe("150 g");
    expect(targetText("sodium", yearTarget("sodium", targets, 0))).toBe("max 2,300 mg");
    expect(targetText("iron", yearTarget("iron", targets, 0))).toBe("8–45 mg");
    expect(targetText("water", yearTarget("water", targets, 1750))).toBe("1.75 L");
    expect(targetText("fat_mono", null)).toBe("");
  });

  const goal: YearTarget = { kind: "goal", target: 2000, upper: null };
  const min: YearTarget = { kind: "min", target: 100, upper: null };
  const max: YearTarget = { kind: "max", target: 2300, upper: null };
  const range: YearTarget = { kind: "range", target: 8, upper: 45 };
  const words = (t: YearTarget, amount: number) =>
    targetWords(t, amount, percentOf(amount, t.target));

  it("a goal uses the bin's words", () => {
    expect(words(goal, 900)).toBe("far under");
    expect(words(goal, 1500)).toBe("under");
    expect(words(goal, 2000)).toBe("on target");
    expect(words(goal, 2330)).toBe("over");
    expect(words(goal, 2800)).toBe("well over");
    expect(words(goal, 3100)).toBe("far over");
  });

  it("a minimum is met at the target and more is fine", () => {
    expect(words(min, 40)).toBe("under your target");
    expect(words(min, 84)).toBe("under your target");
    expect(words(min, 95)).toBe("close to your target");
    expect(words(min, 99.6)).toBe("close to your target");
    expect(words(min, 100)).toBe("target met");
    expect(words(min, 110)).toBe("target met");
    expect(words(min, 160)).toBe("above your target, which is fine");
  });

  it("a maximum is kept up to the limit", () => {
    expect(words(max, 0)).toBe("within the limit");
    expect(words(max, 2300)).toBe("within the limit");
    expect(words(max, 2301)).toBe("over the limit");
    expect(words(max, 5000)).toBe("over the limit");
  });

  it("a range is safe from its target to its upper limit", () => {
    expect(words(range, 3)).toBe("under your target");
    expect(words(range, 7)).toBe("close to your target");
    expect(words(range, 8)).toBe("within the safe range");
    expect(words(range, 45)).toBe("within the safe range");
    expect(words(range, 46)).toBe("over the upper limit");
    expect(words({ ...range, upper: null }, 30)).toBe("above your target, which is fine");
  });
});

describe("the single-hue scale", () => {
  it("shades a day by quarters of the year's highest day; nothing is level 0", () => {
    expect(scaleMax([null, 3, 12, 0, 6])).toBe(12);
    expect(scaleMax([])).toBe(0);
    expect(scaleLevel(0, 12)).toBe(0);
    expect(scaleLevel(5, 0)).toBe(0);
    expect(scaleLevel(1, 12)).toBe(1);
    expect(scaleLevel(3, 12)).toBe(1);
    expect(scaleLevel(3.01, 12)).toBe(2);
    expect(scaleLevel(6, 12)).toBe(2);
    expect(scaleLevel(9, 12)).toBe(3);
    expect(scaleLevel(9.01, 12)).toBe(4);
    expect(scaleLevel(12, 12)).toBe(4);
  });

  it("is used for a nutrient without a target", () => {
    const ctx: LookContext = { today: "2026-11-14", metric: "fat_mono", target: null, max: 20 };
    expect(dayLook("2026-11-10", day("2026-11-10", { value: 15 }), ctx)).toEqual({
      state: "scale",
      level: 3,
      amount: 15,
    });
    expect(dayLook("2026-11-11", day("2026-11-11", { value: 0 }), ctx)).toEqual({
      state: "scale",
      level: 0,
      amount: 0,
    });
  });
});

describe("a day's look and label", () => {
  const energy: LookContext = {
    today: "2026-11-14",
    metric: "energy",
    target: { kind: "goal", target: 2100, upper: null },
    max: 0,
  };

  it("days to come, days without meals and values not recorded", () => {
    expect(dayLook("2026-11-15", day("2026-11-15"), energy)).toEqual({ state: "future" });
    expect(dayLook("2026-11-13", undefined, energy)).toEqual({ state: "none" });
    expect(dayLook("2026-11-13", day("2026-11-13", { meals: 0, waterMl: 500 }), energy)).toEqual({
      state: "none",
    });
    expect(dayLook("2026-11-13", day("2026-11-13", { value: null }), energy)).toEqual({
      state: "unknown",
    });
  });

  it("colours a logged day by its ratio to the target", () => {
    expect(dayLook("2026-11-12", day("2026-11-12", { value: 2330 }), energy)).toMatchObject({
      state: "bin",
      bin: "over",
      percent: 111,
    });
    expect(dayLook("2026-11-14", day("2026-11-14", { value: 0 }), energy)).toMatchObject({
      state: "bin",
      bin: "far_under",
      percent: 0,
    });
  });

  it("water: drinks against the day's own goal; water on its own is a logged day", () => {
    const water: LookContext = {
      today: "2026-11-14",
      metric: "water",
      target: { kind: "min", target: 1800, upper: null },
      max: 0,
    };
    const look = dayLook(
      "2026-11-12",
      day("2026-11-12", { meals: 0, waterMl: 2300, waterGoalMl: 2300 }),
      water,
    );
    expect(look).toMatchObject({ state: "bin", bin: "on_target", percent: 100 });
    expect(dayLook("2026-11-11", day("2026-11-11", { meals: 2, waterMl: 0 }), water)).toMatchObject(
      {
        state: "bin",
        bin: "far_under",
      },
    );
    expect(dayLook("2026-11-10", day("2026-11-10", { meals: 0, waterMl: 0 }), water)).toEqual({
      state: "none",
    });
  });

  it("labels every square in words", () => {
    const at = "2026-11-12";
    const look = (over: Partial<YearDay>, ctx = energy) => dayLook(at, day(at, over), ctx);
    expect(squareLabel(at, look({ value: 2330 }), "energy", day(at))).toBe(
      "Thursday 12 November, 2,330 kcal, over",
    );
    expect(squareLabel(at, { state: "none" }, "energy", undefined)).toBe(
      "Thursday 12 November, no meals",
    );
    expect(squareLabel(at, { state: "none" }, "water", undefined)).toBe(
      "Thursday 12 November, nothing logged",
    );
    expect(squareLabel(at, { state: "future" }, "energy", undefined)).toBe(
      "Thursday 12 November, still to come",
    );
    expect(squareLabel(at, { state: "unknown" }, "vit_d", day(at, { meals: 3 }))).toBe(
      "Thursday 12 November, 3 meals, not recorded",
    );
    const sodium: LookContext = {
      ...energy,
      metric: "sodium",
      target: { kind: "max", target: 2300, upper: null },
    };
    expect(squareLabel(at, look({ value: 1200 }, sodium), "sodium", day(at))).toBe(
      "Thursday 12 November, 1,200 mg, under, within the limit",
    );
    const scale: DayLook = { state: "scale", level: 4, amount: 12.5 };
    expect(squareLabel(at, scale, "fat_mono", day(at))).toBe(
      "Thursday 12 November, 13 g, close to your highest day",
    );
    expect(dayName(at, true)).toBe("Thursday 12 November 2026");
  });

  it("counts the days logged, on target, over, under and not recorded", () => {
    const looks: DayLook[] = [
      { state: "future" },
      { state: "none" },
      { state: "unknown" },
      { state: "scale", level: 2, amount: 3 },
      ...(
        ["far_under", "under", "on_target", "on_target", "over", "well_over", "far_over"] as const
      ).map((bin): DayLook => ({
        state: "bin",
        bin,
        percent: 0,
        amount: 0,
        target: { kind: "goal", target: 1, upper: null },
      })),
    ];
    const counts = yearCounts(looks);
    expect(counts).toEqual({ logged: 9, onTarget: 2, over: 3, under: 2, unknown: 1 });
    expect(countsText(counts, true)).toEqual({
      logged: "9 days logged",
      rest: "2 on target · 3 over · 2 under · 1 not recorded",
    });
    expect(countsText({ logged: 1, onTarget: 0, over: 0, under: 0, unknown: 0 }, false)).toEqual({
      logged: "1 day logged",
      rest: "",
    });
  });
});

describe("the grid", () => {
  // Jan 1: 2024 Monday (leap), 2030 Tuesday, 2025 Wednesday, 2026 Thursday, 2027 Friday,
  // 2028 Saturday (leap), 2023 Sunday, 2040 Sunday (leap).
  it.each([
    [2024, 0, 53, 1],
    [2030, 1, 53, 1],
    [2025, 2, 53, 2],
    [2026, 3, 53, 3],
    [2027, 4, 53, 4],
    [2028, 5, 53, 6],
    [2023, 6, 53, 6],
    [2040, 6, 54, 0],
  ])("%i: Jan 1 on row %i, %i weeks, Dec 31 on row %i", (year, firstRow, weeks, lastRow) => {
    const grid = yearGrid(year);
    expect(grid.weeks).toHaveLength(weeks);
    expect(grid.weeks.every((w) => w.length === 7)).toBe(true);
    expect(grid.weeks[0]![firstRow]).toBe(`${year}-01-01`);
    expect(grid.weeks[0]!.slice(0, firstRow)).toEqual(Array(firstRow).fill(null));
    expect(grid.weeks.at(-1)![lastRow]).toBe(`${year}-12-31`);
    expect(
      grid.weeks
        .at(-1)!
        .slice(lastRow + 1)
        .every((d) => d === null),
    ).toBe(true);
    const dates = grid.weeks.flat().filter(Boolean) as string[];
    expect(dates).toHaveLength(year % 4 === 0 ? 366 : 365);
    expect(new Set(dates).size).toBe(dates.length);
    // Monday on top: every first row is a Monday.
    for (const week of grid.weeks.slice(1))
      expect(new Date(`${week[0]}T12:00:00Z`).getUTCDay()).toBe(1);
  });

  it("2028 is a leap year with 29 February", () => {
    const grid = yearGrid(2028);
    const dates = grid.weeks.flat();
    expect(dates).toContain("2028-02-29");
    expect(dates.indexOf("2028-03-01") - dates.indexOf("2028-02-29")).toBe(1);
  });

  it("labels each month over the first week whose Monday is in it", () => {
    const { months, weeks } = yearGrid(2026);
    expect(months.map((m) => m.label)).toEqual([
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]);
    expect(months[0]!.week).toBe(0);
    expect(weeks[months[8]!.week]![0]).toBe("2026-09-07"); // board 30
    expect(weeks[months[10]!.week]![0]).toBe("2026-11-02");
    expect(weeks[months[11]!.week]![0]).toBe("2026-12-07");
    for (let i = 1; i < 12; i++) expect(months[i]!.week).toBeGreaterThan(months[i - 1]!.week);
  });

  it("moves by day and week with the arrow keys, never past the days that can be opened", () => {
    const first = "2026-01-01";
    const last = "2026-11-14";
    expect(moveInGrid("2026-11-12", "ArrowUp", first, last)).toBe("2026-11-11");
    expect(moveInGrid("2026-11-12", "ArrowDown", first, last)).toBe("2026-11-13");
    expect(moveInGrid("2026-11-12", "ArrowLeft", first, last)).toBe("2026-11-05");
    expect(moveInGrid("2026-11-02", "ArrowUp", first, last)).toBe("2026-11-01");
    expect(moveInGrid("2026-11-12", "ArrowRight", first, last)).toBeNull();
    expect(moveInGrid("2026-11-14", "ArrowDown", first, last)).toBeNull();
    expect(moveInGrid("2026-01-01", "ArrowUp", first, last)).toBeNull();
    expect(moveInGrid("2026-01-05", "ArrowLeft", first, last)).toBeNull();
    expect(moveInGrid("2026-06-01", "Home", first, last)).toBe(first);
    expect(moveInGrid("2026-06-01", "End", first, last)).toBe(last);
    expect(moveInGrid("2026-06-01", "Enter", first, last)).toBeNull();
    expect(lastDayOf(2025, "2026-11-14")).toBe("2025-12-31");
    expect(lastDayOf(2026, "2026-11-14")).toBe("2026-11-14");
  });
});

describe("the menu and the address", () => {
  it("offers every nutrient once, grouped like the catalogue, water from drinks under Other", () => {
    expect([...YEAR_METRICS].sort()).toEqual([...NUTRIENT_CODES].sort());
    expect(YEAR_METRIC_GROUPS.map((g) => g.label)).toEqual([
      "Main",
      "Fats",
      "Carbs",
      "Minerals",
      "Vitamins",
      "Other",
    ]);
    expect(YEAR_METRIC_GROUPS[0]!.codes).toEqual(["energy", "protein", "carbs", "fat"]);
    expect(YEAR_METRIC_GROUPS.at(-1)!.codes[0]).toBe("water");
    expect(metricLabel("energy")).toBe("Calories");
    expect(metricLabel("fat_sat")).toBe("Saturated fat");
    expect(isYearMetric("protein")).toBe(true);
    expect(isYearMetric("fdc:1008")).toBe(false);
    expect(isYearMetric(undefined)).toBe(false);
  });

  it("formats amounts for a glance", () => {
    expect(formatAmount("energy", 2330.4)).toBe("2,330 kcal");
    expect(formatAmount("protein", 142.26)).toBe("142 g");
    expect(formatAmount("protein", 9.26)).toBe("9.3 g");
    expect(formatAmount("thiamin", 1.234)).toBe("1.23 mg");
    expect(formatAmount("water", 1940)).toBe("1.94 L");
    expect(formatAmount("water", 0)).toBe("0 L");
  });

  it("keeps the year between the first year with a meal and now", () => {
    expect(clampYear("2025", 2024, 2026)).toBe(2025);
    expect(clampYear("2019", 2024, 2026)).toBe(2024);
    expect(clampYear("2031", 2024, 2026)).toBe(2026);
    expect(clampYear("twenty", 2024, 2026)).toBe(2026);
    expect(clampYear(undefined, 2024, 2026)).toBe(2026);
    expect(clampYear("2025", 2027, 2026)).toBe(2026);
  });

  it("keeps range and end next to year and metric, defaults left out", () => {
    const today = "2026-11-14";
    expect(trendsHref({ range: "week", end: today, year: 2026, metric: "energy" }, today)).toBe(
      "/trends?range=week",
    );
    expect(
      trendsHref({ range: "month", end: "2026-10-01", year: 2025, metric: "protein" }, today),
    ).toBe("/trends?range=month&end=2026-10-01&year=2025&metric=protein");
  });
});
