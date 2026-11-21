// CONTRACT: Move's points, levels, streak, weekly targets and badges (board 10) and the day's Move
// card on Today (board 9). Plain data, safe for client components.
//
// Server functions (lib/move/service.ts), scoped by user id:
//   getMoveSummary(userId, today)   -> MoveSummaryDto   (also stores newly earned badges)
//   getMoveDay(userId, localDate)   -> MoveDayDto
//   getMoveDayView(userId, date, today) -> MoveDayViewDto   (Move for one day, boards 36 and 39)
//   getEveryDayMonth(userId, month, today) -> EveryDayMonthDto (Move's "Every day", board 40)
// The rules are plain functions in lib/move/score.ts. A day's steps, active time and activity
// calories as the phone counts them (Kal for Android 1.2, DayTotalDto) are shown next to Kal's
// own workouts; points, the streak and the WHO week keep counting Kal's activities.
import type { ActivityCategory, ActivityDto, ActivitySource } from "./activities";

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

/** The goals of a day's steps, active time and activity calories (Settings, with the targets). */
export type MoveGoals = { steps: number; activeMinutes: number; activeKcal: number };

export const MOVE_GOAL_KEYS = ["steps", "activeMinutes", "activeKcal"] as const;
export type MoveGoalKey = (typeof MOVE_GOAL_KEYS)[number];

/** Steps: Move's 7,000 a day; an hour of active time; 500 kcal of activity calories. */
export const DEFAULT_MOVE_GOALS: MoveGoals = {
  steps: WEEKLY_TARGETS.stepsPerDay,
  activeMinutes: 60,
  activeKcal: 500,
};

/** The user_targets codes the goals are kept under, as custom rows (like the water goal). */
export const MOVE_GOAL_CODES: Record<MoveGoalKey, string> = {
  steps: "move_steps",
  activeMinutes: "move_active_minutes",
  activeKcal: "move_active_kcal",
};

/** What a goal may be set to. */
export const MOVE_GOAL_LIMITS: Record<MoveGoalKey, { min: number; max: number }> = {
  steps: { min: 500, max: 100_000 },
  activeMinutes: { min: 5, max: 600 },
  activeKcal: { min: 25, max: 5000 },
};

export const MOVE_GOAL_LABELS: Record<MoveGoalKey, { name: string; unit: string }> = {
  steps: { name: "Steps", unit: "steps" },
  activeMinutes: { name: "Active time", unit: "min" },
  activeKcal: { name: "Activity calories", unit: "kcal" },
};

/** The goals with whether the person set each one (Settings shows Reset for those). */
export type MoveGoalsTarget = Record<MoveGoalKey, { value: number; custom: boolean }>;

export const isMoveGoalCode = (code: unknown): code is string =>
  typeof code === "string" && Object.values(MOVE_GOAL_CODES).includes(code);

/**
 * A day's steps, active time and activity calories as the phone counts them (Kal for Android
 * 1.2), with the app that wrote most of each (a package name) and when it last arrived. Null: the
 * phone could not read that kind.
 */
export type DayTotalDto = {
  date: string;
  steps: number | null;
  stepsApp: string | null;
  activeMinutes: number | null;
  /** How the phone counted the active time ("sessions+steps60"). */
  activeMethod: string | null;
  activeApp: string | null;
  /** Rounded kcal. */
  activeKcal: number | null;
  kcalApp: string | null;
  updatedAt: string;
};

/**
 * The person's Kal for Android: none linked, a linked phone on an app older than 1.2 (it sends no
 * day totals), or 1.2 and newer.
 */
export type PhoneApp = "none" | "old" | "current";

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
  /** "imported", "Phone", "Samsung Health"; null when typed in Kal or none. */
  stepsSource: string | null;
  /** The record the day's steps were taken from (Health Connect's total wins), null without. */
  stepsFrom: { source: ActivitySource; sourceApp: string | null } | null;
  points: number;
  /** Minutes of moderate or harder timed activity (the water estimate). */
  sweatMinutes: number;
  /** Energy of the day's activities in Kal, kcal; null when none has one. */
  energyKcal: number | null;
  /** The phone's numbers for the day (app 1.2), or null. */
  totals: DayTotalDto | null;
  goals: MoveGoals;
};

/** One day of the week strip on Move: its steps; days still to come are drawn outlined. */
export type MoveWeekDayDto = { date: string; steps: number; future: boolean };

/** Move for one local day (boards 36 and 39). */
export type MoveDayViewDto = {
  date: string;
  /** The day's steps as the rules count them (Health Connect's total wins). */
  steps: number;
  /** The steps goal (goals.steps). */
  stepGoal: number;
  goals: MoveGoals;
  /** The phone's steps, active time and activity calories for the day, or null. */
  totals: DayTotalDto | null;
  /** Which Kal for Android the person has, for what a day without totals says. */
  phone: PhoneApp;
  /** Minutes of timed activities. */
  activeMinutes: number;
  /** Energy of the day's activities, kcal (estimates and measured); null when none has one. */
  energyKcal: number | null;
  points: number;
  /** Timed activities (not step counts). */
  workouts: number;
  stepsFrom: { source: ActivitySource; sourceApp: string | null } | null;
  /** The day's activities as they happened, step counts last, each with its share of points. */
  activities: (ActivityDto & { points: number })[];
  /** Monday to Sunday of the day's week. */
  week: MoveWeekDayDto[];
};

/**
 * One day of Move's "Every day" (board 40): the phone's numbers when it sent them; without them
 * the day's steps as Move counts them and no active time or calories. `fromPhone`: a day total.
 */
export type EveryDayRowDto = {
  date: string;
  steps: number | null;
  activeMinutes: number | null;
  activeKcal: number | null;
  fromPhone: boolean;
};

/** A month of "Every day": its days newest first (up to today), and the month before, if any. */
export type EveryDayMonthDto = {
  /** "2026-11". */
  month: string;
  /** "November", or "November 2025" in another year. */
  label: string;
  days: EveryDayRowDto[];
  /** The month before this one when anything is stored before it ("Earlier days"), else null. */
  earlier: string | null;
};
