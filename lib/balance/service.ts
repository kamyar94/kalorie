// The balance score's rankings for Trends (CONTRACT: lib/contracts/balance.ts): the person's three
// most and three least nutritious meals of a period or of all time, worked out from the stored
// meal totals (no AI). One query reads only what the score needs from each meal (energy and the
// twelve nutrients out of the totals, the meal name and state, whether it is drinks only), so
// "All time" stays quick with thousands of meals; the covers are read for the shown six only.
import { and, eq, gte, lte, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { meals } from "@/db/schema";
import type { BalanceListDto, BalanceMealDto, BalanceRankingsDto } from "@/lib/contracts/balance";
import type { MealSlot, MealStatus } from "@/lib/contracts/meals";
import { MEAL_SLOT_LABELS } from "@/lib/contracts/meals";
import type { NutrientCode, NutrientMap } from "@/lib/contracts/nutrients";
import type { NutrientTarget } from "@/lib/contracts/targets";
import { mealCovers } from "@/lib/meals/covers";
import { isUuid } from "@/lib/meals/service";
import { getTargets } from "@/lib/targets/service";
import { countedMeal } from "@/lib/trends/service";

import { balanceOf, ENCOURAGED, LIMITED } from "./score";

const CODES = ["energy", ...ENCOURAGED, ...LIMITED] as const;

/** Just the score's nutrients out of a meal's totals (which also hold every FDC value). */
const SCORE_TOTALS = sql.raw(
  `jsonb_strip_nulls(jsonb_build_object(${CODES.map((code) => `'${code}', meals.totals -> '${code}'`).join(", ")}))`,
);

// Written out: Drizzle leaves the table off column names in a one-table select.
const HAS_ITEMS = sql.raw(`exists (select 1 from meal_items i where i.meal_id = meals.id)`);
const HAS_FOOD = sql.raw(
  `exists (select 1 from meal_items i where i.meal_id = meals.id and i.kind <> 'drink')`,
);

export type BalanceRow = {
  id: string;
  title: string | null;
  slot: MealSlot;
  status: MealStatus;
  localDate: string;
  eatenAt: Date;
  totals: NutrientMap;
  hasItems: boolean;
  hasFood: boolean;
};

/** How many meals of each list are shown. */
export const BALANCE_LIST_SIZE = 3;

/**
 * Splits the judged meals into the best and the worst, at most three each and never the same meal
 * twice: with fewer than six, the better half is "best" and the rest "worst". Ties go to the more
 * recent meal.
 */
export const splitRanking = <T extends { score: number; eatenAt: Date }>(judged: T[]) => {
  const byScore = [...judged].sort(
    (a, b) => b.score - a.score || b.eatenAt.getTime() - a.eatenAt.getTime(),
  );
  const bestCount = Math.min(BALANCE_LIST_SIZE, Math.ceil(byScore.length / 2));
  const best = byScore.slice(0, bestCount);
  const worst = byScore
    .slice(bestCount)
    .sort((a, b) => a.score - b.score || b.eatenAt.getTime() - a.eatenAt.getTime())
    .slice(0, BALANCE_LIST_SIZE);
  return { best, worst };
};

/** The meals a ranking reads: the person's meals Trends counts, in the period when one is given. */
export const balanceRows = async (
  userId: string,
  period: { from: string; to: string } | null,
  dbx: DbOrTx = defaultDb,
): Promise<BalanceRow[]> => {
  if (!isUuid(userId)) return [];
  return dbx
    .select({
      id: meals.id,
      title: meals.title,
      slot: meals.slot,
      status: meals.status,
      localDate: meals.localDate,
      eatenAt: meals.eatenAt,
      totals: sql<NutrientMap>`${SCORE_TOTALS}`,
      hasItems: sql<boolean>`${HAS_ITEMS}`,
      hasFood: sql<boolean>`${HAS_FOOD}`,
    })
    .from(meals)
    .where(
      and(
        eq(meals.userId, userId),
        // As Trends counts them: not deleted, and not a failed analysis with nothing in it.
        countedMeal(),
        ...(period ? [gte(meals.localDate, period.from), lte(meals.localDate, period.to)] : []),
      ),
    );
};

/**
 * The three most and three least nutritious meals of a period (local dates, both ends included)
 * or, with null, of all time.
 */
export const balanceRanking = async (
  userId: string,
  period: { from: string; to: string } | null,
  targets: Partial<Record<NutrientCode, NutrientTarget>>,
  dbx: DbOrTx = defaultDb,
): Promise<BalanceListDto> => {
  const rows = await balanceRows(userId, period, dbx);
  const judged: (BalanceRow & { score: number; reason: string; energy: number })[] = [];
  let leftOut = 0;
  for (const row of rows) {
    const drinksOnly = row.hasItems && !row.hasFood;
    const balance = balanceOf(
      { totals: row.totals ?? {}, slot: row.slot, status: row.status, drinksOnly },
      targets,
    );
    if (balance.judged)
      judged.push({ ...row, score: balance.score, reason: balance.reason, energy: balance.energy });
    else if (balance.why !== "drinks") leftOut += 1;
  }
  const { best, worst } = splitRanking(judged);
  const covers = await mealCovers(
    userId,
    [...best, ...worst].map((m) => m.id),
    dbx,
  );
  const dto = (m: (typeof judged)[number]): BalanceMealDto => ({
    mealId: m.id,
    title: m.title ?? MEAL_SLOT_LABELS[m.slot],
    localDate: m.localDate,
    slot: m.slot,
    energy: m.energy,
    score: m.score,
    reason: m.reason,
    photoUrl: covers.get(m.id)?.photoUrl ?? null,
    foods: covers.get(m.id)?.foods ?? [],
  });
  return { best: best.map(dto), worst: worst.map(dto), judged: judged.length, leftOut };
};

/** Trends' two lists: the period shown and all time, against the person's current targets. */
export const getBalanceRankings = async (
  userId: string,
  period: { from: string; to: string },
  dbx: DbOrTx = defaultDb,
): Promise<BalanceRankingsDto> => {
  const { targets } = await getTargets(userId, dbx);
  const [inPeriod, allTime] = await Promise.all([
    balanceRanking(userId, period, targets, dbx),
    balanceRanking(userId, null, targets, dbx),
  ]);
  return { period: inPeriod, allTime };
};
