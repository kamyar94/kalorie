// CONTRACT: the balance score's rankings on Trends ("Most and least nutritious", board 41).
// lib/balance/service.ts implements it; lib/balance/score.ts works out each meal's score. Plain
// data, safe for client components.
//
//   balanceRanking(userId, period | null, targets)  -> BalanceListDto   (null: all time)
import type { MealFoodDto, MealSlot } from "./meals";

export type BalanceMealDto = {
  mealId: string;
  /** The meal's title, else its meal name. */
  title: string;
  localDate: string;
  slot: MealSlot;
  energy: number;
  score: number;
  /** "Plenty of protein, fiber and potassium; little sodium". */
  reason: string;
  /** The cover photo's thumbnail, else null (then the foods draw the picture). */
  photoUrl: string | null;
  foods: MealFoodDto[];
};

export type BalanceListDto = {
  /** Highest score first; at most three. */
  best: BalanceMealDto[];
  /** Lowest score first; at most three, never one of `best`. */
  worst: BalanceMealDto[];
  /** Meals with a score. */
  judged: number;
  /**
   * Meals left out besides drinks on their own: still being worked out, failed, or too few known
   * nutrients.
   */
  leftOut: number;
};

export type BalanceRankingsDto = {
  /** The period Trends shows (day, week or month). */
  period: BalanceListDto;
  allTime: BalanceListDto;
};
