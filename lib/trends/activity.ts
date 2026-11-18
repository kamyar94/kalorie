// Trends "Activity" (board 37): a period's steps, active minutes by category and workouts per day,
// averages that leave out days without data, the WHO week line Move counts, and the energy from
// activity next to the energy eaten. The service (lib/trends/service.ts) loads the activities;
// the rules are Move's (lib/move/score.ts). Plain functions, safe for client components.
import { ACTIVITY_CATEGORIES, type ActivityCategory } from "@/lib/contracts/activities";
import { WEEKLY_TARGETS } from "@/lib/contracts/move";
import { shiftLocalDate } from "@/lib/meals/time";
import {
  activeMinutes,
  byDay,
  daySteps,
  isWorkout,
  weekRows,
  type ScoredActivity,
} from "@/lib/move/score";
import { weekLabel, weekStart } from "@/lib/move/week";

import { rangeDates, type TrendRange } from "./compute";

/** What Trends needs of an activity: Move's fields and its energy. */
export type TrendActivity = ScoredActivity & { energyKcal: number | null };

export type ActivityDay = {
  date: string;
  /** Any activity record that day: a step count, a workout. */
  logged: boolean;
  /** The day's steps (Move's count); null without a step count. */
  steps: number | null;
  /** All timed minutes; null on a day without any activity record. */
  activeMinutes: number | null;
  /** Timed minutes by category. */
  minutes: Record<ActivityCategory, number>;
  /** Timed activities (not step counts). */
  workouts: number;
  /** Energy of the day's activities, kcal; null when none has one. */
  energyKcal: number | null;
};

/**
 * The WHO line: one week (the Monday-to-Sunday week of a day, or the 7 days of a week's view),
 * or the full Monday-to-Sunday weeks of a month's view.
 */
export type WhoLine =
  | {
      kind: "week";
      /** "Week of 16 to 22 November" for a day's week, null for the period's own 7 days. */
      label: string | null;
      /** Moderate-equivalent minutes of cardio, walks and sports; a vigorous minute counts twice. */
      cardio: number;
      strengthDays: number;
      /** Days that reached the step goal. */
      stepDays: number;
    }
  | {
      kind: "weeks";
      weeks: number;
      cardioMet: number;
      strengthMet: number;
      stepDays: number;
      days: number;
    };

export type ActivityTrends = {
  days: ActivityDay[];
  stepGoal: number;
  /** Days with a step count, with any activity record, and with energy from activity. */
  stepDays: number;
  loggedDays: number;
  energyDays: number;
  /** Means over those days; null without any. */
  averageSteps: number | null;
  averageMinutes: number | null;
  averageEnergy: number | null;
  workouts: number;
  /** Timed minutes of the whole period by category. */
  minutes: Record<ActivityCategory, number>;
  who: WhoLine | null;
};

const noMinutes = () =>
  Object.fromEntries(ACTIVITY_CATEGORIES.map((c) => [c, 0])) as Record<ActivityCategory, number>;

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

const timedMinutes = (list: ScoredActivity[], category: ActivityCategory) =>
  Math.round(
    list
      .filter((a) => isWorkout(a) && a.category === category)
      .reduce((sum, a) => sum + a.durationMin!, 0),
  );

/** One day's numbers; a day without any record is "no data", not zero. */
export const activityDay = (date: string, list: TrendActivity[]): ActivityDay => {
  const steps = daySteps(list);
  const energies = list.filter((a) => a.energyKcal !== null && Number.isFinite(a.energyKcal));
  const minutes = noMinutes();
  for (const category of ACTIVITY_CATEGORIES) minutes[category] = timedMinutes(list, category);
  return {
    date,
    logged: list.length > 0,
    steps: steps > 0 ? steps : null,
    activeMinutes: list.length ? activeMinutes(list) : null,
    minutes,
    workouts: list.filter(isWorkout).length,
    energyKcal: energies.length
      ? Math.round(energies.reduce((sum, a) => sum + a.energyKcal!, 0))
      : null,
  };
};

/** The full Monday-to-Sunday weeks between two days (their Mondays). */
export const fullWeeks = (start: string, end: string) => {
  const mondays: string[] = [];
  let monday = weekStart(start);
  if (monday < start) monday = shiftLocalDate(monday, 7);
  while (shiftLocalDate(monday, 6) <= end) {
    mondays.push(monday);
    monday = shiftLocalDate(monday, 7);
  }
  return mondays;
};

/** The WHO line of a period (activities of the whole Monday-to-Sunday week for a day). */
export const whoLine = (
  range: TrendRange,
  dates: string[],
  activities: TrendActivity[],
  stepGoal: number,
): WhoLine | null => {
  const days = byDay(activities);
  const reached = (from: string) =>
    Array.from({ length: 7 }, (_, i) => shiftLocalDate(from, i)).filter(
      (d) => daySteps(days.get(d) ?? []) >= stepGoal,
    ).length;
  const week = (from: string, label: string | null): WhoLine => {
    const rows = weekRows(days, from);
    return {
      kind: "week",
      label,
      cardio: rows.find((r) => r.category === "cardio")!.value,
      strengthDays: rows.find((r) => r.category === "strength")!.value,
      stepDays: reached(from),
    };
  };
  if (range === "day") {
    const monday = weekStart(dates[0]!);
    return week(monday, `Week of ${weekLabel(monday)}`);
  }
  if (range === "week") return week(dates[0]!, null);
  const mondays = fullWeeks(dates[0]!, dates.at(-1)!);
  if (!mondays.length) return null;
  const weeks = mondays.map((m) => week(m, null) as Extract<WhoLine, { kind: "week" }>);
  return {
    kind: "weeks",
    weeks: mondays.length,
    cardioMet: weeks.filter((w) => w.cardio >= WEEKLY_TARGETS.cardioMinutes).length,
    strengthMet: weeks.filter((w) => w.strengthDays >= WEEKLY_TARGETS.strengthDays).length,
    stepDays: weeks.reduce((sum, w) => sum + w.stepDays, 0),
    days: mondays.length * 7,
  };
};

/**
 * The period's activity. `activities` may reach outside the period (the whole week of a day's
 * view, for the WHO line); only the period's own days count in the days and averages.
 */
export const computeActivityTrends = (input: {
  range: TrendRange;
  end: string;
  activities: TrendActivity[];
  stepGoal?: number;
}): ActivityTrends => {
  const stepGoal = input.stepGoal ?? WEEKLY_TARGETS.stepsPerDay;
  const dates = rangeDates(input.range, input.end);
  const grouped = byDay(input.activities) as Map<string, TrendActivity[]>;
  const days = dates.map((date) => activityDay(date, grouped.get(date) ?? []));
  const steps = days.flatMap((d) => (d.steps === null ? [] : [d.steps]));
  const minutesOf = days.flatMap((d) => (d.activeMinutes === null ? [] : [d.activeMinutes]));
  const energy = days.flatMap((d) => (d.energyKcal === null ? [] : [d.energyKcal]));
  const minutes = noMinutes();
  for (const day of days)
    for (const category of ACTIVITY_CATEGORIES) minutes[category] += day.minutes[category];
  return {
    days,
    stepGoal,
    stepDays: steps.length,
    loggedDays: minutesOf.length,
    energyDays: energy.length,
    averageSteps: mean(steps),
    averageMinutes: mean(minutesOf),
    averageEnergy: mean(energy),
    workouts: days.reduce((sum, d) => sum + d.workouts, 0),
    minutes,
    who: whoLine(input.range, dates, input.activities, stepGoal),
  };
};

const n = (value: number) => Math.round(value).toLocaleString("en-US");
const plural = (count: number, one: string, many = `${one}s`) =>
  `${n(count)} ${count === 1 ? one : many}`;

/**
 * "WHO week: cardio 125 of 150 min · strength 2 of 2 days · steps on 3 of 7 days"; for a month,
 * "WHO weeks, 4 full weeks: cardio target met in 2 · strength in 3 · steps on 12 of 28 days".
 */
export const whoText = (line: WhoLine) => {
  if (line.kind === "week")
    return `${line.label ? `WHO ${line.label.replace(/^Week/, "week")}` : "WHO week"}: cardio ${n(line.cardio)} of ${WEEKLY_TARGETS.cardioMinutes} min · strength ${line.strengthDays} of ${WEEKLY_TARGETS.strengthDays} days · steps on ${line.stepDays} of 7 days`;
  return `WHO weeks, ${plural(line.weeks, "full week")}: cardio target met in ${line.cardioMet} · strength in ${line.strengthMet} · steps on ${line.stepDays} of ${line.days} days`;
};

/**
 * What the averages count: "Averages leave out days without data: steps from 5 of 7 days, active
 * minutes from 6." Null when every day has both.
 */
export const averagesCaption = (trends: ActivityTrends) => {
  const total = trends.days.length;
  if (total === 1 || (trends.stepDays === total && trends.loggedDays === total)) return null;
  return `Averages leave out days without data, rather than count them as zero: steps from ${trends.stepDays} of ${total} days, active minutes from ${trends.loggedDays}.`;
};

/**
 * "Eaten and burned": "Daily average: eaten 1,903 kcal, burned in activity 214 kcal, target 1,859
 * + activity." (for a day: "The day: eaten ...").
 */
export const eatenBurnedText = (input: {
  range: TrendRange;
  eaten: number | null;
  burned: number | null;
  target: number | null;
}) => {
  const lead = input.range === "day" ? "The day" : "Daily average";
  const eaten = input.eaten === null ? "no meals logged" : `eaten ${n(input.eaten)} kcal`;
  const burned =
    input.burned === null
      ? "no energy from activity"
      : `burned in activity ${n(input.burned)} kcal`;
  const target = input.target ? `, target ${n(input.target)} + activity` : "";
  return `${lead}: ${eaten}, ${burned}${target}.`;
};
