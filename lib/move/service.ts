// Move's summary and Today's Move card (CONTRACT: lib/contracts/move.ts), computed from the
// person's activities with the rules in score.ts. Earned badges are stored once (user_badges), so
// a badge stays earned when older data is later removed. Scoped by user id; values never logged.
import { and, between, eq, isNull } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { activities, foods, mealItems, meals, userBadges } from "@/db/schema";
import {
  ACTIVITY_CATEGORY_LABELS,
  sourceLabel,
  STEPS_TYPE,
  type ActivitySource,
} from "@/lib/contracts/activities";
import {
  BADGES,
  isBadgeCode,
  type BadgeCode,
  type MoveDayDto,
  type MoveSummaryDto,
} from "@/lib/contracts/move";
import { isUuid } from "@/lib/meals/service";
import { totalWaterMl } from "@/lib/meals/hydration";
import { shiftLocalDate } from "@/lib/meals/time";
import { getTargets } from "@/lib/targets/service";

import {
  activeMinutes,
  byDay,
  currentStreak,
  dayPoints,
  daySteps,
  earnedBadges,
  isActiveDay,
  levelOf,
  sweatMinutes,
  weekRows,
  type BadgeDay,
  type ScoredActivity,
} from "./score";
import { dayWaterGoalMl } from "./water";
import { weekStart } from "./week";

/** How far back the water goal is checked for its badges. */
const WATER_DAYS = 120;

type Row = {
  localDate: string;
  category: ScoredActivity["category"];
  type: string;
  durationMin: number | null;
  intensity: ScoredActivity["intensity"];
  steps: number | null;
  source: ActivitySource;
  sourceApp: string | null;
  title: string;
};

const scored = (row: Row): ScoredActivity & Row => ({
  ...row,
  stepsOnly: row.type === STEPS_TYPE || (!row.durationMin && !!row.steps),
});

const loadActivities = async (userId: string, dbx: DbOrTx, day?: string) =>
  (
    await dbx
      .select({
        localDate: activities.localDate,
        category: activities.category,
        type: activities.type,
        durationMin: activities.durationMin,
        intensity: activities.intensity,
        steps: activities.steps,
        source: activities.source,
        sourceApp: activities.sourceApp,
        title: activities.title,
      })
      .from(activities)
      .where(and(eq(activities.userId, userId), day ? eq(activities.localDate, day) : undefined))
  ).map(scored);

/** Water from drinks per local day between two days (both included). */
export const waterByDay = async (userId: string, from: string, to: string, dbx: DbOrTx) => {
  const rows = await dbx
    .select({
      date: meals.localDate,
      name: mealItems.name,
      kind: mealItems.kind,
      ml: mealItems.ml,
      grams: mealItems.grams,
      count: mealItems.count,
      nutrients: mealItems.nutrients,
      foodName: foods.nameEn,
    })
    .from(mealItems)
    .innerJoin(meals, eq(meals.id, mealItems.mealId))
    .leftJoin(foods, eq(foods.id, mealItems.foodId))
    .where(
      and(
        eq(meals.userId, userId),
        eq(mealItems.userId, userId),
        isNull(meals.deletedAt),
        between(meals.localDate, from, to),
      ),
    );
  const days = new Map<string, typeof rows>();
  for (const row of rows) days.set(row.date, [...(days.get(row.date) ?? []), row]);
  return new Map([...days].map(([date, items]) => [date, totalWaterMl(items)]));
};

/** Points, level, streak, the week by category and the badges; stores newly earned badges. */
export const getMoveSummary = async (
  userId: string,
  today: string,
  dbx: DbOrTx = defaultDb,
): Promise<MoveSummaryDto> => {
  const rows = isUuid(userId) ? await loadActivities(userId, dbx) : [];
  const days = byDay(rows);
  let total = 0;
  for (const [date, list] of days) if (date <= today) total += dayPoints(list);
  const level = levelOf(total);

  const from = shiftLocalDate(today, -WATER_DAYS);
  const [water, targets, stored] = isUuid(userId)
    ? await Promise.all([
        waterByDay(userId, from, today, dbx),
        getTargets(userId, dbx),
        dbx.select().from(userBadges).where(eq(userBadges.userId, userId)),
      ])
    : [new Map<string, number>(), null, []];
  const base = targets?.hydration.goalMl ?? 0;
  const dates = new Set([...days.keys(), ...water.keys()]);
  const history: BadgeDay[] = [...dates]
    .filter((date) => date <= today)
    .map((date) => ({
      date,
      activities: days.get(date) ?? [],
      waterGoalMet:
        base > 0 &&
        (water.get(date) ?? 0) >= dayWaterGoalMl(base, sweatMinutes(days.get(date) ?? [])),
    }));
  const earned = earnedBadges(history);
  const known = new Map(
    stored.filter((b) => isBadgeCode(b.code)).map((b) => [b.code as BadgeCode, b.earnedOn]),
  );
  const fresh = [...earned].filter(([code]) => !known.has(code));
  if (fresh.length && isUuid(userId))
    await dbx
      .insert(userBadges)
      .values(fresh.map(([code, earnedOn]) => ({ userId, code, earnedOn })))
      .onConflictDoNothing();
  for (const [code, date] of fresh) known.set(code, date);

  return {
    points: {
      total,
      today: dayPoints(days.get(today) ?? []),
      level: level.level,
      levelStart: level.levelStart,
      nextLevelAt: level.nextLevelAt,
    },
    streak: {
      days: currentStreak(days, today),
      activeToday: isActiveDay(days.get(today) ?? []),
    },
    week: { start: weekStart(today), rows: weekRows(days, weekStart(today)) },
    badges: BADGES.map((badge) => ({ ...badge, earnedOn: known.get(badge.code) ?? null })),
  };
};

/** Today's Move card for one local day. */
export const getMoveDay = async (
  userId: string,
  localDate: string,
  dbx: DbOrTx = defaultDb,
): Promise<MoveDayDto> => {
  const rows = isUuid(userId) ? await loadActivities(userId, dbx, localDate) : [];
  const longest = rows
    .filter((r) => !r.stepsOnly && r.durationMin)
    .sort((a, b) => (b.durationMin ?? 0) - (a.durationMin ?? 0))[0];
  const steps = daySteps(rows);
  const stepsRow = rows
    .filter((r) => r.stepsOnly && r.steps === steps)
    .sort((a, b) => a.source.localeCompare(b.source))[0];
  return {
    activeMinutes: activeMinutes(rows),
    activeLabel: longest
      ? [
          ACTIVITY_CATEGORY_LABELS[longest.category],
          longest.source === "manual" ? null : sourceLabel(longest.source, longest.sourceApp),
        ]
          .filter(Boolean)
          .join(", ")
      : null,
    steps,
    stepsSource:
      !stepsRow || stepsRow.source === "manual"
        ? null
        : stepsRow.source === "import"
          ? "imported"
          : sourceLabel(stepsRow.source, stepsRow.sourceApp),
    points: dayPoints(rows),
    sweatMinutes: sweatMinutes(rows),
  };
};
