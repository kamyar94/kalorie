// Trends "Your year" (boards 30 to 33 and 38): a GitHub-style calendar of one calendar year for
// one nutrient or one measure of activity. What the card offers (activity, then grouped like the
// nutrient catalogue), the colour bins of a day's amount against its target (and the "more is
// better" bins of steps and active minutes against Move's goals), the words for each kind of
// target, the single-hue scale of a metric without a target, the labels, the week grid and the
// keyboard moves. The service (lib/trends/year-service.ts) loads the days; the card
// (components/trends/year-card.tsx) draws them. Plain functions, safe for client components and
// unit tests.
import { WEEKLY_TARGETS } from "@/lib/contracts/move";
import {
  MACRO_CODES,
  NUTRIENT_CATALOGUE,
  nutrientInfo,
  type NutrientCode,
  type NutrientGroup,
} from "@/lib/contracts/nutrients";
import type { NutrientTarget, TargetKind } from "@/lib/contracts/targets";
import { shiftLocalDate } from "@/lib/meals/time";

import type { TrendRange } from "./compute";

// ---- What the year can show ----

/**
 * Activity (board 38): steps against Move's step goal; active minutes, the moderate-equivalent
 * minutes Move counts for the WHO week (walks, cardio and sports at moderate effort or harder, a
 * vigorous minute counting twice), against a seventh of the WHO week's 150; and the energy of
 * the day's activities, without a target.
 */
export const ACTIVITY_METRICS = ["steps", "active_minutes", "activity_energy"] as const;
export type ActivityMetric = (typeof ACTIVITY_METRICS)[number];

/** What the year can show: a nutrient (water from drinks for "water") or a measure of activity. */
export type YearMetric = NutrientCode | ActivityMetric;

export const isActivityMetric = (value: unknown): value is ActivityMetric =>
  typeof value === "string" && (ACTIVITY_METRICS as readonly string[]).includes(value);

/** Calories unless the address says otherwise. */
export const DEFAULT_YEAR_METRIC: YearMetric = "energy";

const codesOf = (group: NutrientGroup) =>
  NUTRIENT_CATALOGUE.filter((n) => n.group === group).map((n) => n.code);

/**
 * The menu (boards 32 and 38): Activity, then the nutrients grouped like the catalogue. "water" is
 * the water from drinks, as the Today screen's Water card counts it, against the day's water goal
 * (not the water in food).
 */
export const YEAR_METRIC_GROUPS: readonly { label: string; codes: readonly YearMetric[] }[] = [
  { label: "Activity", codes: ACTIVITY_METRICS },
  { label: "Main", codes: MACRO_CODES },
  { label: "Fats", codes: codesOf("fat") },
  { label: "Carbs", codes: codesOf("carb") },
  { label: "Minerals", codes: codesOf("mineral") },
  { label: "Vitamins", codes: codesOf("vitamin") },
  { label: "Other", codes: ["water", ...codesOf("other").filter((code) => code !== "water")] },
];

export const YEAR_METRICS: readonly YearMetric[] = YEAR_METRIC_GROUPS.flatMap((g) => g.codes);

export const isYearMetric = (value: unknown): value is YearMetric =>
  typeof value === "string" && (YEAR_METRICS as readonly string[]).includes(value);

const MAIN_LABELS: Partial<Record<YearMetric, string>> = {
  steps: "Steps",
  active_minutes: "Active minutes",
  activity_energy: "Energy from activity",
  energy: "Calories",
  protein: "Protein",
  carbs: "Carbs",
  fat: "Fat",
  water: "Water",
};

/** "Calories", "Protein", "Saturated fat", "Water", "Steps". */
export const metricLabel = (code: YearMetric) =>
  MAIN_LABELS[code] ?? nutrientInfo(code)?.name ?? code;

// ---- Targets ----

/**
 * The target a day is compared with: its amount, its kind and the upper end of a range. "more":
 * a goal where more is better (steps, active minutes), with its own bins.
 */
export type YearTarget = { kind: TargetKind | "more"; target: number; upper: number | null };

/** Active minutes a day: a seventh of the WHO week's 150 moderate minutes. */
export const ACTIVE_MINUTES_A_DAY = WEEKLY_TARGETS.cardioMinutes / 7;

/**
 * The metric's target from getTargets, or null when it has none (the single-hue scale is used).
 * Water from drinks is compared with the water goal; drinking more than it is fine ("min").
 * Steps are compared with the step goal and active minutes with a seventh of the WHO week; the
 * energy of activity has no target.
 */
export const yearTarget = (
  code: YearMetric,
  targets: Partial<Record<NutrientCode, NutrientTarget>>,
  waterGoalMl: number,
  stepGoal: number = WEEKLY_TARGETS.stepsPerDay,
): YearTarget | null => {
  if (code === "steps")
    return stepGoal > 0 ? { kind: "more", target: stepGoal, upper: null } : null;
  if (code === "active_minutes") return { kind: "more", target: ACTIVE_MINUTES_A_DAY, upper: null };
  if (code === "activity_energy") return null;
  if (code === "water")
    return waterGoalMl > 0 ? { kind: "min", target: waterGoalMl, upper: null } : null;
  const row = targets[code];
  if (!row?.target || !(row.target > 0)) return null;
  return {
    kind: row.kind,
    target: row.target,
    upper: row.kind === "range" && row.upper && row.upper > row.target ? row.upper : null,
  };
};

// ---- Numbers ----

const nf = (value: number, decimals: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: decimals });

/**
 * An amount with its unit, rounded for a glance: whole numbers from 10 up ("142 g", "2,330 kcal"),
 * the catalogue's decimals below ("1.25 mg"), water from drinks in litres ("1.94 L").
 */
export const formatAmount = (code: YearMetric, value: number) => {
  if (code === "water") return `${nf(value / 1000, 2)} L`;
  if (code === "steps") return `${nf(value, 0)} steps`;
  if (code === "active_minutes") return `${nf(value, 1)} min`;
  if (code === "activity_energy") return `${nf(value, 0)} kcal`;
  const info = nutrientInfo(code);
  const decimals = Math.abs(value) >= 10 ? 0 : (info?.decimals ?? 1);
  return `${nf(value, decimals)} ${info?.unit ?? ""}`.trim();
};

/**
 * The target as the menu shows it: "2,100 kcal", "max 2,300 mg", "8–45 mg", "7,000 a day",
 * "21.4 min a day"; "" without one.
 */
export const targetText = (code: YearMetric, target: YearTarget | null) => {
  if (!target) return "";
  if (target.kind === "more")
    return code === "steps"
      ? `${nf(target.target, 0)} a day`
      : `${formatAmount(code, target.target)} a day`;
  if (target.kind === "max") return `max ${formatAmount(code, target.target)}`;
  if (target.kind === "range" && target.upper)
    return `${formatAmount(code, target.target).replace(/\s.*$/, "")}–${formatAmount(code, target.upper)}`;
  return formatAmount(code, target.target);
};

// ---- Colour bins ----

/** The bins of the legend, the same for every nutrient (board 30). */
export const YEAR_BINS = [
  "far_under",
  "under",
  "on_target",
  "over",
  "well_over",
  "far_over",
] as const;
export type YearBin = (typeof YEAR_BINS)[number];

export const BIN_LABELS: Record<YearBin, string> = {
  far_under: "Far under",
  under: "Under",
  on_target: "On target",
  over: "Over",
  well_over: "Well over",
  far_over: "Far over",
};

/** The percent range of each bin, as the wide legend shows it (board 33). */
export const BIN_RANGES: Record<YearBin, string> = {
  far_under: "under 50%",
  under: "50–85%",
  on_target: "85–110%",
  over: "110–125%",
  well_over: "125–150%",
  far_over: "over 150%",
};

/** The day's amount as a whole percent of the target (what the summary shows). */
export const percentOf = (amount: number, target: number) => Math.round((amount / target) * 100);

/**
 * The bin of a whole percent, so the colour always matches the percent shown: under 50 far
 * under; 50 to 84 under; 85 to 110 on target; 111 to 125 over; 126 to 150 well over; above 150
 * far over.
 */
export const binFor = (percent: number): YearBin =>
  percent < 50
    ? "far_under"
    : percent < 85
      ? "under"
      : percent <= 110
        ? "on_target"
        : percent <= 125
          ? "over"
          : percent <= 150
            ? "well_over"
            : "far_over";

/**
 * What the amount means for this kind of target. A goal (energy, carbs, fat) uses the bin's own
 * words. A minimum (protein, fiber, vitamins, water) is met at the target, and more is fine. A
 * maximum (sodium, saturated fat, added sugars) is kept up to the target. A range (RDA to upper
 * limit) is safe between the two.
 */
export const targetWords = (target: YearTarget, amount: number, percent: number) => {
  const below = percent >= 85 ? "close to your target" : "under your target";
  switch (target.kind) {
    case "more":
      return MORE_LABELS[moreBinFor(percent)].toLowerCase();
    case "goal":
      return BIN_LABELS[binFor(percent)].toLowerCase();
    case "max":
      return amount <= target.target ? "within the limit" : "over the limit";
    case "range":
      if (amount < target.target) return below;
      if (target.upper !== null)
        return amount <= target.upper ? "within the safe range" : "over the upper limit";
      break;
    case "min":
      break;
  }
  if (amount < target.target) return below;
  return percent > 110 ? "above your target, which is fine" : "target met";
};

// ---- Activity: more is better ----

/**
 * The bins of steps and active minutes against their goal (board 38): under half of it, under
 * it, reached, and one and a half times it or more.
 */
export const MORE_BINS = ["more_low", "more_under", "more_met", "more_high"] as const;
export type MoreBin = (typeof MORE_BINS)[number];

export const MORE_LABELS: Record<MoreBin, string> = {
  more_low: "Under half the goal",
  more_under: "Under the goal",
  more_met: "Goal reached",
  more_high: "Well past the goal",
};

/**
 * The day's amount as a whole percent of its goal, rounded down, so 6,980 of 7,000 steps is 99 %,
 * not a reached goal.
 */
export const morePercent = (amount: number, target: number) =>
  Math.floor((amount / target) * 100 + 1e-9);

/** Under 50 %; 50 to 99; 100 to 149; 150 and more. */
export const moreBinFor = (percent: number): MoreBin =>
  percent < 50
    ? "more_low"
    : percent < 100
      ? "more_under"
      : percent < 150
        ? "more_met"
        : "more_high";

/**
 * The amounts of each bin, for the legend: "under 3,500", "3,500–6,999", "7,000–10,499", "10,500
 * and more" for steps against 7,000; "under 11 min" ... for minutes (whole amounts).
 */
export const moreRanges = (code: YearMetric, target: number): Record<MoreBin, string> => {
  const [half, goal, past] = [0.5, 1, 1.5].map((share) => Math.ceil(target * share - 1e-9)) as [
    number,
    number,
    number,
  ];
  const unit = code === "steps" ? "" : " min";
  return {
    more_low: `under ${nf(half, 0)}${unit}`,
    more_under: `${nf(half, 0)}–${nf(goal - 1, 0)}${unit}`,
    more_met: `${nf(goal, 0)}–${nf(past - 1, 0)}${unit}`,
    more_high: `${nf(past, 0)}${unit} and more`,
  };
};

// ---- The scale of a nutrient without a target ----

/** Levels 0 (none) to 4: lighter is less. */
export const SCALE_LEVELS = [0, 1, 2, 3, 4] as const;
export type ScaleLevel = (typeof SCALE_LEVELS)[number];

export const SCALE_WORDS: Record<ScaleLevel, string> = {
  0: "none",
  1: "up to a quarter of your highest day",
  2: "up to half of your highest day",
  3: "up to three quarters of your highest day",
  4: "close to your highest day",
};

/** The highest amount of the year's logged days (0 when there is none). */
export const scaleMax = (amounts: Iterable<number | null>) => {
  let max = 0;
  for (const value of amounts) if (typeof value === "number" && value > max) max = value;
  return max;
};

/** A day's level against the year's highest day: quarters of it, 0 for nothing. */
export const scaleLevel = (amount: number, max: number): ScaleLevel => {
  if (!(amount > 0) || !(max > 0)) return 0;
  const share = amount / max;
  return share <= 0.25 ? 1 : share <= 0.5 ? 2 : share <= 0.75 ? 3 : 4;
};

// ---- The days ----

/** One local day of the year, as the service sends it (only days with something in them). */
export type YearDay = {
  date: string;
  /** Meals of the day; water added on its own and failed meals without items do not count. */
  meals: number;
  /** The metric's amount; null when none of the day's meals has a value for it. */
  value: number | null;
  energy: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** Water from drinks, ml (Today's Water card). */
  waterMl: number;
  /** The day's water goal: the hydration target and the activity estimate (Today's). */
  waterGoalMl: number;
  /** Steps of the day (Move). */
  steps: number;
  /** Any activity record that day (a step count, a workout). */
  activity: boolean;
  /** Minutes of timed activity (Move's day). */
  activeMinutes: number;
  /** Moderate-equivalent minutes for the WHO week: what "Active minutes" compares. */
  whoMinutes: number;
  /** Timed activities (not step counts). */
  workouts: number;
  /** Energy of the day's activities, kcal; null when none has one. */
  activityEnergy: number | null;
};

export type YearData = {
  year: number;
  metric: YearMetric;
  today: string;
  /** The first year with a meal or an activity (the pager goes back to it), at most this year. */
  firstYear: number;
  /** Days with meals, water or activity, oldest first. */
  days: YearDay[];
  /** Move's step goal. */
  stepGoal: number;
  /** The first day of the year with steps from Health Connect, null without. */
  stepsSince: string | null;
  targets: Partial<Record<NutrientCode, NutrientTarget>>;
  /** The hydration target without activity, ml. */
  waterGoalMl: number;
  /**
   * Kal keeps no history of targets (they follow the profile as it is now), so every day is
   * compared with the current targets and the card says so.
   */
  currentTargets: true;
};

export type DayLook =
  | { state: "future" }
  | { state: "none" }
  | { state: "unknown" }
  | { state: "bin"; bin: YearBin; percent: number; amount: number; target: YearTarget }
  | { state: "more"; bin: MoreBin; percent: number; amount: number; target: YearTarget }
  | { state: "scale"; level: ScaleLevel; amount: number };

export type LookContext = {
  today: string;
  metric: YearMetric;
  target: YearTarget | null;
  /** The year's highest amount, for the scale. */
  max: number;
};

/**
 * Whether the day counts as logged for the metric: a meal (water: or water on its own); steps: a
 * step count; active minutes and energy from activity: any activity record.
 */
export const isLogged = (day: YearDay | undefined, metric: YearMetric) => {
  if (!day) return false;
  if (metric === "steps") return day.steps > 0;
  if (isActivityMetric(metric)) return day.activity;
  return day.meals > 0 || (metric === "water" && day.waterMl > 0);
};

/** The amount of the metric on a logged day (water from drinks for "water"). */
export const amountOf = (day: YearDay, metric: YearMetric) => {
  switch (metric) {
    case "water":
      return day.waterMl;
    case "steps":
      return day.steps;
    case "active_minutes":
      return day.whoMinutes;
    case "activity_energy":
      return day.activityEnergy;
    default:
      return day.value;
  }
};

/** How a square looks and what it says. */
export const dayLook = (date: string, day: YearDay | undefined, ctx: LookContext): DayLook => {
  if (date > ctx.today) return { state: "future" };
  if (!day || !isLogged(day, ctx.metric)) return { state: "none" };
  const amount = amountOf(day, ctx.metric);
  if (amount === null || !Number.isFinite(amount)) return { state: "unknown" };
  if (!ctx.target) return { state: "scale", level: scaleLevel(amount, ctx.max), amount };
  if (ctx.target.kind === "more") {
    const percent = morePercent(amount, ctx.target.target);
    return { state: "more", bin: moreBinFor(percent), percent, amount, target: ctx.target };
  }
  // The water goal moves with the day's activity, as on Today.
  const target =
    ctx.metric === "water" && day.waterGoalMl > 0
      ? { ...ctx.target, target: day.waterGoalMl }
      : ctx.target;
  const percent = percentOf(amount, target.target);
  return { state: "bin", bin: binFor(percent), percent, amount, target };
};

export type YearCounts = {
  logged: number;
  onTarget: number;
  over: number;
  under: number;
  unknown: number;
};

/** The line under the legend: days logged, on target, over and under. */
export const yearCounts = (looks: Iterable<DayLook>): YearCounts => {
  const counts: YearCounts = { logged: 0, onTarget: 0, over: 0, under: 0, unknown: 0 };
  for (const look of looks) {
    if (look.state === "future" || look.state === "none") continue;
    counts.logged += 1;
    if (look.state === "unknown") counts.unknown += 1;
    if (look.state === "more") {
      if (look.bin === "more_met" || look.bin === "more_high") counts.onTarget += 1;
      else counts.under += 1;
      continue;
    }
    if (look.state !== "bin") continue;
    if (look.bin === "on_target") counts.onTarget += 1;
    else if (look.bin === "far_under" || look.bin === "under") counts.under += 1;
    else counts.over += 1;
  }
  return counts;
};

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export const mealsText = (n: number) => (n ? plural(n, "meal") : "no meals");

/**
 * For activity: "3 days with steps" or "5 days with activity", and "1 at goal" (with a goal),
 * "2 not recorded" (energy).
 */
export const activityCountsText = (
  counts: YearCounts,
  metric: ActivityMetric,
  withGoal: boolean,
) => ({
  logged: `${plural(counts.logged, "day")} with ${metric === "steps" ? "steps" : "activity"}`,
  rest: [
    ...(withGoal ? [`${counts.onTarget} at goal`] : []),
    ...(counts.unknown ? [`${counts.unknown} not recorded`] : []),
  ].join(" · "),
});

/** "14 days logged" and "6 on target · 5 over · 3 under" (empty without a target). */
export const countsText = (counts: YearCounts, withTarget: boolean) => ({
  logged: `${plural(counts.logged, "day")} logged`,
  rest: [
    ...(withTarget
      ? [`${counts.onTarget} on target`, `${counts.over} over`, `${counts.under} under`]
      : []),
    ...(counts.unknown ? [`${counts.unknown} not recorded`] : []),
  ].join(" · "),
});

/** "Thursday 12 November" (with the year when asked). */
export const dayName = (date: string, withYear = false) => {
  const at = new Date(`${date}T12:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) =>
    at.toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });
  return [
    part({ weekday: "long" }),
    part({ day: "numeric" }),
    part({ month: "long" }),
    ...(withYear ? [part({ year: "numeric" })] : []),
  ].join(" ");
};

/** What a day without data is: "no meals", "nothing logged" (water), "no steps recorded". */
export const noneWords = (metric: YearMetric) =>
  metric === "water"
    ? "nothing logged"
    : metric === "steps"
      ? "no steps recorded"
      : isActivityMetric(metric)
        ? "no activity recorded"
        : "no meals";

/** The spoken label of a square: "Thursday 12 November, 2,330 kcal, over". */
export const squareLabel = (
  date: string,
  look: DayLook,
  metric: YearMetric,
  day: YearDay | undefined,
) => {
  const name = dayName(date);
  switch (look.state) {
    case "future":
      return `${name}, still to come`;
    case "none":
      return `${name}, ${noneWords(metric)}`;
    case "unknown":
      return metric === "activity_energy"
        ? `${name}, activity without energy, not recorded`
        : `${name}, ${mealsText(day?.meals ?? 0)}, not recorded`;
    case "more":
      return `${name}, ${formatAmount(metric, look.amount)}, ${MORE_LABELS[look.bin].toLowerCase()}`;
    case "scale":
      return `${name}, ${formatAmount(metric, look.amount)}, ${SCALE_WORDS[look.level]}`;
    case "bin": {
      const words =
        look.target.kind === "goal"
          ? ""
          : `, ${targetWords(look.target, look.amount, look.percent)}`;
      return `${name}, ${formatAmount(metric, look.amount)}, ${BIN_LABELS[look.bin].toLowerCase()}${words}`;
    }
  }
};

// ---- The grid ----

export const isLeapYear = (year: number) =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export const yearStart = (year: number) => `${String(year).padStart(4, "0")}-01-01`;
export const yearEnd = (year: number) => `${String(year).padStart(4, "0")}-12-31`;

export type YearGrid = {
  /** Week columns, Monday to Sunday; null for the days of the years before and after. */
  weeks: (string | null)[][];
  /** Month labels: the first week whose Monday is in the month (January on the first week). */
  months: { label: string; week: number }[];
};

/** Weeks as columns and Monday to Sunday as rows, as GitHub draws a year. */
export const yearGrid = (year: number): YearGrid => {
  const first = yearStart(year);
  const offset = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday 0
  const days = isLeapYear(year) ? 366 : 365;
  const columns = Math.ceil((offset + days) / 7);
  const monday = shiftLocalDate(first, -offset);
  const prefix = `${first.slice(0, 4)}-`;
  const weeks = Array.from({ length: columns }, (_, week) =>
    Array.from({ length: 7 }, (_, row) => {
      const date = shiftLocalDate(monday, week * 7 + row);
      return date.startsWith(prefix) ? date : null;
    }),
  );
  const months = Array.from({ length: 12 }, (_, m) => {
    const month = `${prefix}${String(m + 1).padStart(2, "0")}`;
    const week = m === 0 ? 0 : weeks.findIndex((w) => w[0]?.startsWith(month));
    return {
      label: new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        timeZone: "UTC",
      }),
      week,
    };
  });
  return { weeks, months };
};

/** The last day of the year that can have data: today in the current year, else 31 December. */
export const lastDayOf = (year: number, today: string) =>
  yearEnd(year) < today ? yearEnd(year) : today;

/**
 * Where an arrow key moves in the grid: up and down by a day, left and right by a week, Home and
 * End to the first and last day. Null when the move would leave the days that can be opened.
 */
export const moveInGrid = (date: string, key: string, first: string, last: string) => {
  const next =
    key === "ArrowUp"
      ? shiftLocalDate(date, -1)
      : key === "ArrowDown"
        ? shiftLocalDate(date, 1)
        : key === "ArrowLeft"
          ? shiftLocalDate(date, -7)
          : key === "ArrowRight"
            ? shiftLocalDate(date, 7)
            : key === "Home"
              ? first
              : key === "End"
                ? last
                : null;
  return next && next >= first && next <= last ? next : null;
};

/** The year asked for, kept between the first year with a meal and the current year. */
export const clampYear = (requested: unknown, firstYear: number, currentYear: number) => {
  const n = typeof requested === "string" && /^\d{4}$/.test(requested) ? Number(requested) : NaN;
  if (!Number.isInteger(n)) return currentYear;
  return Math.min(currentYear, Math.max(Math.min(firstYear, currentYear), n));
};

// ---- The address ----

export type TrendsUrlState = {
  range: TrendRange;
  end: string;
  year: number;
  metric: YearMetric;
};

/** The Trends address; the year card's year and metric live next to the period's range and end. */
export const trendsHref = (state: TrendsUrlState, today: string) => {
  const params = new URLSearchParams({ range: state.range });
  if (state.end !== today) params.set("end", state.end);
  if (String(state.year) !== today.slice(0, 4)) params.set("year", String(state.year));
  if (state.metric !== DEFAULT_YEAR_METRIC) params.set("metric", state.metric);
  return `/trends?${params.toString()}`;
};
