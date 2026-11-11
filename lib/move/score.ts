// Move's rules as plain functions (CONTRACT: lib/contracts/move.ts): points per activity and per
// day, levels with rising thresholds, the streak, the week by category against the WHO targets,
// and when each badge was earned.
import type { ActivityCategory, ActivitySource, Intensity } from "@/lib/contracts/activities";
import {
  ACTIVE_DAY,
  POINT_RULES,
  WEEKLY_TARGETS,
  type BadgeCode,
  type WeekRowDto,
} from "@/lib/contracts/move";
import { shiftLocalDate } from "@/lib/meals/time";

import { weekDays, weekStart } from "./week";

/** What the rules need of an activity. */
export type ScoredActivity = {
  localDate: string;
  category: ActivityCategory;
  durationMin: number | null;
  intensity: Intensity | null;
  steps: number | null;
  /** A day's step count (type "steps", no duration). */
  stepsOnly: boolean;
  /** Where it came from; Health Connect's step totals win over the others. */
  source?: ActivitySource;
};

/** Points of a timed activity (steps are counted per day). */
export const activityPoints = (a: ScoredActivity) => {
  const minutes = a.durationMin && a.durationMin > 0 ? a.durationMin : 0;
  if (!minutes || a.stepsOnly) return 0;
  if (a.intensity === "vigorous") return Math.round(minutes * POINT_RULES.vigorousMinute);
  if (a.intensity === "light") return Math.floor(minutes / POINT_RULES.lightMinutesPerPoint);
  return Math.round(minutes * POINT_RULES.moderateMinute);
};

export const stepPoints = (steps: number) =>
  Math.floor(Math.min(steps, POINT_RULES.stepsCap) / 1000) * POINT_RULES.per1000Steps;

/**
 * A day's steps. Health Connect's day total when there is one: its aggregate already merges the
 * phone and the watch without counting a step twice. Otherwise the highest count any other source
 * gave for the day (an import and a typed total overlap, so they are not added up).
 */
export const daySteps = (activities: ScoredActivity[]) => {
  const counts = activities.filter((a) => a.stepsOnly && a.steps);
  const healthConnect = counts.filter((a) => a.source === "health_connect");
  return (healthConnect.length ? healthConnect : counts).reduce(
    (most, a) => Math.max(most, a.steps!),
    0,
  );
};

const timed = (a: ScoredActivity) => !a.stepsOnly && !!a.durationMin && a.durationMin > 0;

export const activeMinutes = (activities: ScoredActivity[]) =>
  Math.round(activities.filter(timed).reduce((sum, a) => sum + a.durationMin!, 0));

/** Minutes of moderate or harder timed activity (unknown effort counts as moderate). */
export const sweatMinutes = (activities: ScoredActivity[]) =>
  Math.round(
    activities
      .filter((a) => timed(a) && a.intensity !== "light")
      .reduce((sum, a) => sum + a.durationMin!, 0),
  );

/** Points of one day's activities. */
export const dayPoints = (activities: ScoredActivity[]) => {
  const strength = activities.filter((a) => timed(a) && a.category === "strength").length;
  return (
    activities.reduce((sum, a) => sum + activityPoints(a), 0) +
    stepPoints(daySteps(activities)) +
    Math.min(strength, POINT_RULES.strengthSessionsPerDay) * POINT_RULES.strengthSession
  );
};

/** The points a level starts at: 0, 150, 450, 900, 1,500, 2,250... (75 x n x (n - 1)). */
export const levelThreshold = (level: number) => 75 * level * (level - 1);

export const levelOf = (points: number) => {
  let level = 1;
  while (levelThreshold(level + 1) <= points) level += 1;
  return { level, levelStart: levelThreshold(level), nextLevelAt: levelThreshold(level + 1) };
};

/** Activities grouped by local day. */
export const byDay = (activities: ScoredActivity[]) => {
  const days = new Map<string, ScoredActivity[]>();
  for (const a of activities) {
    const list = days.get(a.localDate);
    if (list) list.push(a);
    else days.set(a.localDate, [a]);
  }
  return days;
};

export const isActiveDay = (activities: ScoredActivity[]) =>
  activeMinutes(activities) >= ACTIVE_DAY.minutes || daySteps(activities) >= ACTIVE_DAY.steps;

/**
 * Days in a row that were active, ending today, or yesterday while today is not active yet (a
 * streak is not lost before the day is over).
 */
export const currentStreak = (days: Map<string, ScoredActivity[]>, today: string) => {
  const active = (date: string) => isActiveDay(days.get(date) ?? []);
  let day = active(today) ? today : shiftLocalDate(today, -1);
  let count = 0;
  while (active(day)) {
    count += 1;
    day = shiftLocalDate(day, -1);
  }
  return count;
};

/** Moderate-equivalent aerobic minutes (WHO): cardio, walks and sports; vigorous counts twice. */
export const cardioMinutes = (activities: ScoredActivity[]) =>
  Math.round(
    activities
      .filter(
        (a) =>
          timed(a) &&
          a.intensity !== "light" &&
          (a.category === "cardio" ||
            a.category === "walking" ||
            a.category === "sports" ||
            a.category === "other"),
      )
      .reduce((sum, a) => sum + a.durationMin! * (a.intensity === "vigorous" ? 2 : 1), 0),
  );

const minutesOf = (activities: ScoredActivity[], category: ActivityCategory) =>
  Math.round(
    activities
      .filter((a) => timed(a) && a.category === category)
      .reduce((sum, a) => sum + a.durationMin!, 0),
  );

const strengthDays = (days: Map<string, ScoredActivity[]>, dates: string[]) =>
  dates.filter((d) => (days.get(d) ?? []).some((a) => timed(a) && a.category === "strength"))
    .length;

/** The week of `monday` by category, against the weekly targets. */
export const weekRows = (days: Map<string, ScoredActivity[]>, monday: string): WeekRowDto[] => {
  const dates = weekDays(monday);
  const week = dates.flatMap((d) => days.get(d) ?? []);
  const rows: WeekRowDto[] = [
    {
      category: "cardio",
      value: cardioMinutes(week),
      target: WEEKLY_TARGETS.cardioMinutes,
      unit: "min",
    },
    {
      category: "strength",
      value: strengthDays(days, dates),
      target: WEEKLY_TARGETS.strengthDays,
      unit: "days",
    },
    {
      category: "walking",
      value: dates.reduce((sum, d) => sum + daySteps(days.get(d) ?? []), 0),
      target: WEEKLY_TARGETS.stepsPerDay * 7,
      unit: "steps",
    },
    {
      category: "mobility",
      value: minutesOf(week, "mobility"),
      target: WEEKLY_TARGETS.mobilityMinutes,
      unit: "min",
    },
    { category: "sports", value: minutesOf(week, "sports"), target: null, unit: "min" },
  ];
  const other = minutesOf(week, "other");
  if (other) rows.push({ category: "other", value: other, target: null, unit: "min" });
  return rows;
};

/** One day for the badges: its activities and whether the water goal was reached. */
export type BadgeDay = { date: string; activities: ScoredActivity[]; waterGoalMet: boolean };

/**
 * The day each badge was first earned, from the whole history (any order of days). Badges that
 * are not earned are absent.
 */
export const earnedBadges = (history: BadgeDay[]): Map<BadgeCode, string> => {
  const earned = new Map<BadgeCode, string>();
  const earn = (code: BadgeCode, date: string) => {
    if (!earned.has(code)) earned.set(code, date);
  };
  const days = [...history].sort((a, b) => a.date.localeCompare(b.date));
  let workouts = 0;
  let streak = 0;
  let water = 0;
  let previous: string | null = null;
  const weeks = new Map<string, { cardio: number; strength: Set<string> }>();
  for (const day of days) {
    const consecutive = previous !== null && shiftLocalDate(previous, 1) === day.date;
    for (const a of day.activities.filter(timed)) {
      workouts += 1;
      if (workouts === 1) earn("first_workout", day.date);
      if (workouts === 10) earn("workouts_10", day.date);
      if (workouts === 50) earn("workouts_50", day.date);
      const week = weekStart(day.date);
      const totals = weeks.get(week) ?? { cardio: 0, strength: new Set<string>() };
      weeks.set(week, totals);
      totals.cardio += cardioMinutes([a]);
      if (a.category === "strength") totals.strength.add(day.date);
      if (totals.cardio >= WEEKLY_TARGETS.cardioMinutes) earn("week_150", day.date);
      if (totals.strength.size >= WEEKLY_TARGETS.strengthDays) earn("strength_2", day.date);
    }
    if (daySteps(day.activities) >= 10_000) earn("steps_10k", day.date);
    streak = isActiveDay(day.activities) ? (consecutive ? streak : 0) + 1 : 0;
    if (streak >= 3) earn("streak_3", day.date);
    if (streak >= 7) earn("streak_7", day.date);
    if (streak >= 30) earn("streak_30", day.date);
    water = day.waterGoalMet ? (consecutive ? water : 0) + 1 : 0;
    if (water >= 3) earn("water_3", day.date);
    if (water >= 7) earn("water_7", day.date);
    previous = day.date;
  }
  return earned;
};
