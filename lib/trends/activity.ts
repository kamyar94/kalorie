// Trends "Activity" (boards 37 and 40): a period's steps, active time and activity calories per day
// (the phone's day totals from Kal for Android 1.2 where it sent them, else Move's rules: the
// timed minutes and the energy of Kal's activities), Kal's workout minutes by category, averages
// that leave out days without data, the WHO week line Move counts, and the activity calories next
// to the energy eaten. The service (lib/trends/service.ts) loads the activities and day totals;
// the rules are Move's (lib/move/score.ts). Plain functions, safe for client components.
import { ACTIVITY_CATEGORIES, type ActivityCategory } from "@/lib/contracts/activities";
import {
  DEFAULT_MOVE_GOALS,
  WEEKLY_TARGETS,
  type DayTotalDto,
  type MoveGoals,
} from "@/lib/contracts/move";
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
  /** Any activity record or day total that day: a step count, a workout, the phone's numbers. */
  logged: boolean;
  /** The phone's day total arrived for the day (its numbers win below). */
  fromPhone: boolean;
  /** The day's steps (Move's count, else the phone's); null without a step count. */
  steps: number | null;
  /**
   * Active time: the phone's when it sent one, else all timed minutes in Kal; null on a day
   * without any of them.
   */
  activeMinutes: number | null;
  /** Kal's timed minutes by category. */
  minutes: Record<ActivityCategory, number>;
  /** Timed activities (not step counts). */
  workouts: number;
  /**
   * Activity calories: the phone's when it sent them, else the energy of the day's activities in
   * Kal; null when there is none.
   */
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
  /** The goals of the three numbers (Settings). */
  goals: MoveGoals;
  /** Days with the phone's day total. */
  phoneDays: number;
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

/**
 * One day's numbers; a day without any record is "no data", not zero. The phone's day total wins
 * for active time and activity calories when it has them; Move's steps win for steps (they come
 * from the same Health Connect total).
 */
export const activityDay = (
  date: string,
  list: TrendActivity[],
  total: DayTotalDto | null = null,
): ActivityDay => {
  const steps = daySteps(list) || total?.steps || 0;
  const energies = list.filter((a) => a.energyKcal !== null && Number.isFinite(a.energyKcal));
  const kalEnergy = energies.length
    ? Math.round(energies.reduce((sum, a) => sum + a.energyKcal!, 0))
    : null;
  const minutes = noMinutes();
  for (const category of ACTIVITY_CATEGORIES) minutes[category] = timedMinutes(list, category);
  const kalMinutes = list.length ? activeMinutes(list) : null;
  return {
    date,
    logged: list.length > 0 || total !== null,
    fromPhone: total !== null,
    steps: steps > 0 ? steps : null,
    activeMinutes: total?.activeMinutes ?? kalMinutes,
    minutes,
    workouts: list.filter(isWorkout).length,
    energyKcal: total?.activeKcal ?? kalEnergy,
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
  /** The phone's day totals of the period. */
  dayTotals?: DayTotalDto[];
  goals?: MoveGoals;
}): ActivityTrends => {
  const goals = input.goals ?? DEFAULT_MOVE_GOALS;
  const stepGoal = goals.steps;
  const dates = rangeDates(input.range, input.end);
  const grouped = byDay(input.activities);
  const totals = new Map((input.dayTotals ?? []).map((t) => [t.date, t]));
  const days = dates.map((date) =>
    activityDay(date, grouped.get(date) ?? [], totals.get(date) ?? null),
  );
  const steps = days.flatMap((d) => (d.steps === null ? [] : [d.steps]));
  const minutesOf = days.flatMap((d) => (d.activeMinutes === null ? [] : [d.activeMinutes]));
  const energy = days.flatMap((d) => (d.energyKcal === null ? [] : [d.energyKcal]));
  const minutes = noMinutes();
  for (const day of days)
    for (const category of ACTIVITY_CATEGORIES) minutes[category] += day.minutes[category];
  return {
    days,
    stepGoal,
    goals,
    phoneDays: days.filter((d) => d.fromPhone).length,
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
 * What the averages count: "Averages leave out days without data, rather than count them as zero:
 * steps from 5 of 7 days, active time from 6, activity calories from 4." Null when every day has
 * all three.
 */
export const averagesCaption = (trends: ActivityTrends) => {
  const total = trends.days.length;
  if (
    total === 1 ||
    (trends.stepDays === total && trends.loggedDays === total && trends.energyDays === total)
  )
    return null;
  return `Averages leave out days without data, rather than count them as zero: steps from ${trends.stepDays} of ${total} days, active time from ${trends.loggedDays}, activity calories from ${trends.energyDays}.`;
};

/**
 * Where the numbers come from: "Active time and activity calories are the phone's on 5 of 7 days
 * (Kal for Android); on the others they come from your activities in Kal." Null without any day
 * total, or when every day has one.
 */
export const phoneCaption = (trends: ActivityTrends) => {
  const total = trends.days.length;
  if (!trends.phoneDays) return null;
  if (trends.phoneDays === total)
    return total === 1
      ? "Active time and activity calories are the phone's (Kal for Android)."
      : "Active time and activity calories are the phone's on every day (Kal for Android).";
  return `Active time and activity calories are the phone's on ${trends.phoneDays} of ${total} days (Kal for Android); on the others they come from your activities in Kal.`;
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
    input.burned === null ? "no activity calories" : `burned in activity ${n(input.burned)} kcal`;
  const target = input.target ? `, target ${n(input.target)} + activity` : "";
  return `${lead}: ${eaten}, ${burned}${target}.`;
};
