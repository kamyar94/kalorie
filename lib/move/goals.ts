// The goals of a day's steps, active time and activity calories (CONTRACT: lib/contracts/move.ts
// MoveGoals). Kept like the water goal: a custom row in user_targets under MOVE_GOAL_CODES, set in
// Settings next to the other targets and reset there; without one the default applies. Move's
// ring and rows, Today's card, Trends and the year compare with them. Scoped by user id.
import { and, eq, inArray } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { userTargets } from "@/db/schema";
import {
  DEFAULT_MOVE_GOALS,
  MOVE_GOAL_CODES,
  MOVE_GOAL_KEYS,
  MOVE_GOAL_LIMITS,
  MOVE_GOAL_LABELS,
  type MoveGoalKey,
  type MoveGoals,
  type MoveGoalsTarget,
} from "@/lib/contracts/move";
import { isUuid } from "@/lib/meals/service";

/** The goals from the person's custom rows (code and target), defaults where none is set. */
export const moveGoalsFromRows = (
  rows: { nutrientCode: string; target: number | null }[],
): MoveGoalsTarget =>
  Object.fromEntries(
    MOVE_GOAL_KEYS.map((key) => {
      const own = rows.find((r) => r.nutrientCode === MOVE_GOAL_CODES[key] && r.target);
      return [
        key,
        own
          ? { value: own.target!, custom: true }
          : { value: DEFAULT_MOVE_GOALS[key], custom: false },
      ];
    }),
  ) as MoveGoalsTarget;

export const goalValues = (target: MoveGoalsTarget): MoveGoals => ({
  steps: target.steps.value,
  activeMinutes: target.activeMinutes.value,
  activeKcal: target.activeKcal.value,
});

/** The person's goals (only their own user_targets rows are read). */
export const getMoveGoals = async (userId: string, dbx: DbOrTx = defaultDb): Promise<MoveGoals> => {
  if (!isUuid(userId)) return { ...DEFAULT_MOVE_GOALS };
  const rows = await dbx
    .select({ nutrientCode: userTargets.nutrientCode, target: userTargets.target })
    .from(userTargets)
    .where(
      and(
        eq(userTargets.userId, userId),
        eq(userTargets.custom, true),
        inArray(userTargets.nutrientCode, Object.values(MOVE_GOAL_CODES)),
      ),
    );
  return goalValues(moveGoalsFromRows(rows));
};

/** Which goal a user_targets code is, or null. */
export const moveGoalKey = (code: string): MoveGoalKey | null =>
  MOVE_GOAL_KEYS.find((key) => MOVE_GOAL_CODES[key] === code) ?? null;

export class MoveGoalError extends Error {}

/** Sets one goal; it stays until reset (resetTarget with its code). */
export const setMoveGoal = async (
  userId: string,
  key: MoveGoalKey,
  value: number,
  dbx: DbOrTx = defaultDb,
) => {
  const { min, max } = MOVE_GOAL_LIMITS[key];
  if (!Number.isFinite(value) || value < min || value > max) {
    const unit = MOVE_GOAL_LABELS[key].unit;
    throw new MoveGoalError(
      `Give a goal from ${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")} ${unit}.`,
    );
  }
  const target = Math.round(value);
  const code = MOVE_GOAL_CODES[key];
  await dbx
    .insert(userTargets)
    .values({ userId, nutrientCode: code, target, kind: "goal", custom: true })
    .onConflictDoUpdate({
      target: [userTargets.userId, userTargets.nutrientCode],
      set: { target, kind: "goal", custom: true, updatedAt: new Date() },
    });
};
