// CONTRACT: Move's points, levels, streak, weekly targets and badges (board 10) and the day's Move
// card on Today (board 9). Plain data, safe for client components.
//
// Server functions (lib/move/service.ts), scoped by user id:
//   getMoveSummary(userId, today)   -> MoveSummaryDto   (also stores newly earned badges)
//   getMoveDay(userId, localDate)   -> MoveDayDto
// The rules are plain functions in lib/move/score.ts.
import type { ActivityCategory } from "./activities";

/**
 * Points: 1 per minute of moderate activity, 2 per vigorous minute, 1 per 2 light minutes;
 * 5 per 1,000 steps a day up to 15,000 steps; 15 more per strength session (2 a day at most).
 */
export const POINT_RULES = {
  moderateMinute: 1,
  vigorousMinute: 2,
  lightMinutesPerPoint: 2,
  per1000Steps: 5,
  stepsCap: 15_000,
  strengthSession: 15,
  strengthSessionsPerDay: 2,
} as const;

/** A day counts for the streak with 20 active minutes or 5,000 steps. */
export const ACTIVE_DAY = { minutes: 20, steps: 5000 } as const;

/**
 * Weekly targets. WHO 2020 guidelines on physical activity: at least 150 minutes of moderate
 * aerobic activity a week (a vigorous minute counts as two), and muscle-strengthening activity on
 * 2 or more days. Steps (7,000 a day) and mobility (an hour a week) are Kal's own targets, not
 * WHO's.
 */
export const WEEKLY_TARGETS = {
  cardioMinutes: 150,
  strengthDays: 2,
  stepsPerDay: 7000,
  mobilityMinutes: 60,
} as const;

export type BadgeCode =
  | "first_workout"
  | "streak_3"
  | "streak_7"
  | "streak_30"
  | "steps_10k"
  | "week_150"
  | "strength_2"
  | "water_3"
  | "water_7"
  | "workouts_10"
  | "workouts_50";

export type BadgeIcon = "medal" | "flame" | "steps" | "heart" | "dumbbell" | "water" | "trophy";

export type BadgeInfo = { code: BadgeCode; label: string; condition: string; icon: BadgeIcon };

export const BADGES: BadgeInfo[] = [
  {
    code: "first_workout",
    label: "First workout",
    condition: "Log your first workout",
    icon: "medal",
  },
  {
    code: "streak_3",
    label: "3-day streak",
    condition: "Be active 3 days in a row",
    icon: "flame",
  },
  {
    code: "streak_7",
    label: "7-day streak",
    condition: "Be active 7 days in a row",
    icon: "flame",
  },
  {
    code: "streak_30",
    label: "30-day streak",
    condition: "Be active 30 days in a row",
    icon: "flame",
  },
  { code: "steps_10k", label: "10k steps day", condition: "10,000 steps in a day", icon: "steps" },
  {
    code: "week_150",
    label: "150-minute week",
    condition: "150 minutes of cardio in one week",
    icon: "heart",
  },
  {
    code: "strength_2",
    label: "Strength twice",
    condition: "Strength training on 2 days of one week",
    icon: "dumbbell",
  },
  {
    code: "water_3",
    label: "Water goal 3 days",
    condition: "Reach your water goal 3 days in a row",
    icon: "water",
  },
  {
    code: "water_7",
    label: "Water goal 7 days",
    condition: "Reach your water goal 7 days in a row",
    icon: "water",
  },
  { code: "workouts_10", label: "10 workouts", condition: "Log 10 workouts", icon: "trophy" },
  { code: "workouts_50", label: "50 workouts", condition: "Log 50 workouts", icon: "trophy" },
];

export const isBadgeCode = (value: unknown): value is BadgeCode =>
  typeof value === "string" && BADGES.some((b) => b.code === value);

export type BadgeDto = BadgeInfo & {
  /** The local day it was earned, null while locked. */
  earnedOn: string | null;
};

export type WeekRowDto = {
  category: ActivityCategory;
  /** Minutes (cardio: vigorous minutes count twice), strength days, or steps for walking. */
  value: number;
  /** Null: no target for this category. */
  target: number | null;
  unit: "min" | "days" | "steps";
};

export type MoveSummaryDto = {
  points: {
    total: number;
    today: number;
    level: number;
    /** Points at which the current level started and the next one starts. */
    levelStart: number;
    nextLevelAt: number;
  };
  streak: { days: number; activeToday: boolean };
  week: { start: string; rows: WeekRowDto[] };
  badges: BadgeDto[];
};

export type MoveDayDto = {
  /** Minutes of timed activities. */
  activeMinutes: number;
  /** "Strength, openGym": the category (and source) of the day's longest activity. */
  activeLabel: string | null;
  steps: number;
  /** "imported", "from openGym", null when typed in Kal or none. */
  stepsSource: string | null;
  points: number;
  /** Minutes of moderate or harder timed activity (the water estimate). */
  sweatMinutes: number;
};
