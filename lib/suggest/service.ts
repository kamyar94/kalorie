// "What should I eat?" for the signed-in person (CONTRACT: lib/contracts/suggest.ts): today's
// meals, the last four weeks' pattern and the last 90 days' meals and favorites, read from the
// database and handed to lib/suggest/compute.ts. "Now" and "today" are in the zone given (the
// device's), so a phone abroad gets its own lunch time. Everything comes from the person's own
// data; no AI.
import { and, count, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { aiKeys, mealItems, meals, users } from "@/db/schema";
import { balanceOf, ENCOURAGED, LIMITED } from "@/lib/balance/score";
import type { MealSlot } from "@/lib/contracts/meals";
import { MEAL_SLOT_LABELS } from "@/lib/contracts/meals";
import { sumNutrients, type NutrientMap } from "@/lib/contracts/nutrients";
import type { SuggestionsDto } from "@/lib/contracts/suggest";
import { mealCovers } from "@/lib/meals/covers";
import { isWaterName } from "@/lib/meals/hydration";
import { isUuid, listMealsForDay } from "@/lib/meals/service";
import {
  DEFAULT_MEAL_WINDOWS,
  localParts,
  shiftLocalDate,
  slotForMinutes,
  type MealWindows,
} from "@/lib/meals/time";
import { getTargets } from "@/lib/targets/service";
import { countedMeal } from "@/lib/trends/service";

import {
  badgeFor,
  balancedIdea,
  candidateKey,
  eatingPattern,
  introFor,
  leftToday,
  noteFor,
  rankCandidates,
  sizeNow,
  SUGGEST,
  type Candidate,
  type PatternMeal,
} from "./compute";

const CODES = ["energy", ...ENCOURAGED, ...LIMITED] as const;
const SCORE_TOTALS = sql.raw(
  `jsonb_strip_nulls(jsonb_build_object(${CODES.map((code) => `'${code}', meals.totals -> '${code}'`).join(", ")}))`,
);
// Written out: Drizzle leaves the table off column names in a one-table select.
const HAS_FOOD = sql.raw(
  `exists (select 1 from meal_items i where i.meal_id = meals.id and i.kind <> 'drink')`,
);

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** What the suggestions and the AI's idea both start from: now, what is left, the pattern. */
export const suggestionContext = async (
  userId: string,
  at: { now: Date; tz: string },
  dbx: DbOrTx = defaultDb,
) => {
  const { date: today, time, minutes } = localParts(at.now, at.tz);
  const [{ targets }, todays, history, profile] = await Promise.all([
    getTargets(userId, dbx),
    listMealsForDay(userId, today, dbx),
    dbx
      .select({
        localDate: meals.localDate,
        eatenAt: meals.eatenAt,
        tz: meals.tz,
        slot: meals.slot,
        energy: sql<unknown>`${meals.totals} -> 'energy'`,
        food: sql<boolean>`${HAS_FOOD}`,
      })
      .from(meals)
      .where(
        and(
          eq(meals.userId, userId),
          countedMeal(),
          gte(meals.localDate, shiftLocalDate(today, -SUGGEST.patternDays)),
          lte(meals.localDate, shiftLocalDate(today, -1)),
        ),
      ),
    dbx
      .select({ windows: users.mealWindows, cuisines: users.cuisines })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
  ]);
  // Water added on its own is not a meal (the Water card's glasses and bottles).
  const eatenMeals = todays.filter(
    (m) =>
      !(
        (m.source === "manual" || m.source === "duplicate") &&
        m.photos.length === 0 &&
        m.itemCount === 1 &&
        m.foods[0] &&
        isWaterName(m.foods[0].name)
      ),
  );
  const pending = eatenMeals.filter((m) => m.status === "queued" || m.status === "analysing");
  const left = leftToday(sumNutrients(eatenMeals.map((m) => m.totals)), targets, pending.length);
  const pattern = eatingPattern(
    history.map((m): PatternMeal => ({
      localDate: m.localDate,
      minutes: localParts(m.eatenAt, m.tz).minutes,
      slot: m.slot,
      energy: finite(m.energy) ? m.energy : 0,
      food: m.food,
    })),
    minutes,
  );
  const windows = (profile[0]?.windows as MealWindows | null) ?? DEFAULT_MEAL_WINDOWS;
  const slotNow: MealSlot = slotForMinutes(minutes, windows);
  const size = sizeNow(left, pattern, slotNow);
  return {
    today,
    time,
    targets,
    left,
    pattern,
    slotNow,
    size,
    cuisines: (profile[0]?.cuisines ?? []) as string[],
  };
};

/** The person's meals that could be suggested: favorites and the last 90 days, one per meal. */
const candidatesOf = async (
  userId: string,
  today: string,
  targets: Awaited<ReturnType<typeof getTargets>>["targets"],
  dbx: DbOrTx,
) => {
  const since = shiftLocalDate(today, -SUGGEST.candidateDays);
  const rows = await dbx
    .select({
      id: meals.id,
      title: meals.title,
      slot: meals.slot,
      localDate: meals.localDate,
      eatenAt: meals.eatenAt,
      favoriteAt: meals.favoriteAt,
      totals: sql<NutrientMap>`${SCORE_TOTALS}`,
      food: sql<boolean>`${HAS_FOOD}`,
    })
    .from(meals)
    .where(
      and(
        eq(meals.userId, userId),
        isNull(meals.deletedAt),
        inArray(meals.status, ["ready", "needs_input"]),
        or(gte(meals.localDate, since), isNotNull(meals.favoriteAt)),
      ),
    );
  const usable = rows.filter((r) => r.food && finite(r.totals?.energy) && r.totals.energy >= 20);
  if (!usable.length) return [];
  const items = await dbx
    .select({ mealId: mealItems.mealId, name: mealItems.name })
    .from(mealItems)
    .where(
      and(
        inArray(
          mealItems.mealId,
          usable.map((r) => r.id),
        ),
        eq(mealItems.userId, userId),
      ),
    );
  const namesOf = new Map<string, string[]>();
  for (const item of items)
    namesOf.set(item.mealId, [...(namesOf.get(item.mealId) ?? []), item.name]);
  const groups = new Map<string, typeof usable>();
  for (const row of usable) {
    const key = candidateKey(row.title ?? "", namesOf.get(row.id) ?? []);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map((group): Candidate => {
    const latest = [...group].sort((a, b) => b.eatenAt.getTime() - a.eatenAt.getTime());
    // A favorite is logged as the favorite (so "Log a favorite again" knows it was used).
    const rep =
      [...group]
        .filter((r) => r.favoriteAt)
        .sort((a, b) => b.favoriteAt!.getTime() - a.favoriteAt!.getTime())[0] ?? latest[0]!;
    const balance = balanceOf(
      { totals: rep.totals, slot: rep.slot, status: "ready", drinksOnly: false },
      targets,
    );
    return {
      mealId: rep.id,
      title: rep.title ?? MEAL_SLOT_LABELS[rep.slot],
      slot: rep.slot,
      totals: rep.totals,
      favorite: !!rep.favoriteAt,
      times: group.filter((r) => r.localDate >= since).length,
      lastAt: latest[0]!.eatenAt,
      score: balance.judged ? balance.score : null,
    };
  });
};

/** Whether the person saved any AI key (then "Something new" can ask it). */
export const hasAiKey = async (userId: string, dbx: DbOrTx = defaultDb) => {
  const [row] = await dbx.select({ n: count() }).from(aiKeys).where(eq(aiKeys.userId, userId));
  return (row?.n ?? 0) > 0;
};

/** Suggestions for now in `tz`: what is left today, the pattern and the top three meals. */
export const getSuggestions = async (
  userId: string,
  at: { now: Date; tz: string },
  dbx: DbOrTx = defaultDb,
): Promise<SuggestionsDto | null> => {
  if (!isUuid(userId)) return null;
  const ctx = await suggestionContext(userId, at, dbx);
  const [candidates, aiAvailable] = await Promise.all([
    candidatesOf(userId, ctx.today, ctx.targets, dbx),
    hasAiKey(userId, dbx),
  ]);
  const ranked = rankCandidates(candidates, {
    now: at.now,
    left: ctx.left,
    pattern: ctx.pattern,
    size: ctx.size,
  }).slice(0, SUGGEST.shown);
  const covers = await mealCovers(
    userId,
    ranked.map((r) => r.mealId),
    dbx,
  );
  const { afterWindow: _afterWindow, ...pattern } = ctx.pattern;
  return {
    time: ctx.time,
    date: ctx.today,
    tz: at.tz,
    intro: introFor(ctx.time, ctx.pattern),
    left: ctx.left,
    pattern,
    size: ctx.size,
    suggestions: ranked.map((r, index) => ({
      mealId: r.mealId,
      title: r.title,
      slot: r.slot,
      energy: r.totals.energy ?? 0,
      badge: badgeFor(r, index),
      favorite: r.favorite,
      times: r.times,
      reason: r.reason,
      score: r.score,
      photoUrl: covers.get(r.mealId)?.photoUrl ?? null,
      foods: covers.get(r.mealId)?.foods ?? [],
    })),
    history: ctx.pattern.enough ? "enough" : "little",
    note: noteFor(ctx.left, ranked.length, candidates.length),
    idea: candidates.length ? null : balancedIdea(ctx.left, ctx.size),
    aiAvailable,
  };
};
