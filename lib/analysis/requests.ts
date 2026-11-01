// What the meal screen asks of the analysis (CONTRACT: lib/contracts/analysis.ts): answer a
// question, fix the meal with a sentence, or try again. Each stores the person's input on the meal,
// sets it "queued" and enqueues an analysis in the same transaction; the worker reads the input
// from the meal row. Scoped by user id: another person's meal behaves like a missing one.
import { and, eq, isNull, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { mealPhotos, meals } from "@/db/schema";
import {
  ANALYSIS_INPUT_LIMITS,
  type AnalysisRequestResult,
  type AnalyzeMealReason,
} from "@/lib/contracts/analysis";
import { enqueueMealAnalysis } from "@/lib/meals/create";
import { getMeal, isUuid } from "@/lib/meals/service";
import { takeRateLimit } from "@/lib/rate-limit";

/** Re-analysis requests per account: 30 per 10 minutes, 200 per day. */
export const ANALYSIS_REQUEST_WINDOWS = [
  { name: "10min", windowMs: 10 * 60_000, max: 30 },
  { name: "day", windowMs: 86_400_000, max: 200 },
];

type MealRow = typeof meals.$inferSelect;

const cleanText = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

const notFound: AnalysisRequestResult = { ok: false, status: 404, error: "Meal not found." };

/**
 * Shared steps: rate limit, the meal (locked), its photos, the change, status queued, the job.
 * change returns the new column values, or an error result.
 */
const requestAnalysis = async (
  userId: string,
  mealId: string,
  reason: AnalyzeMealReason,
  replaceEdits: boolean,
  change: (meal: MealRow) => Partial<typeof meals.$inferInsert> | AnalysisRequestResult,
  dbx: DbOrTx,
): Promise<AnalysisRequestResult> => {
  if (!isUuid(userId) || !isUuid(mealId)) return notFound;
  const limit = await takeRateLimit(`analysis:${userId}`, ANALYSIS_REQUEST_WINDOWS, dbx);
  if (!limit.ok)
    return { ok: false, status: 429, error: "Too many requests. Try again in a few minutes." };

  const outcome = await dbx.transaction(async (tx) => {
    const meal = (
      await tx
        .select()
        .from(meals)
        .where(and(eq(meals.id, mealId), eq(meals.userId, userId), isNull(meals.deletedAt)))
        .for("update")
        .limit(1)
    )[0];
    if (!meal) return notFound;
    const photos = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(mealPhotos)
      .where(eq(mealPhotos.mealId, mealId));
    if (!Number(photos[0]?.n))
      return {
        ok: false as const,
        status: 409 as const,
        error: "This meal has no photos to analyse. Change its items by hand.",
      };
    const values = change(meal);
    if ("ok" in values) return values;
    await tx
      .update(meals)
      .set({ ...values, status: "queued", error: null })
      .where(eq(meals.id, mealId));
    await enqueueMealAnalysis({ mealId, userId, reason, replaceEdits }, tx);
    return null;
  });
  if (outcome) return outcome;
  const meal = await getMeal(userId, mealId, dbx);
  return meal ? { ok: true, meal } : notFound;
};

/** Answers one of the meal's questions (or changes an answer) and analyses again. */
export const answerQuestion = async (
  userId: string,
  mealId: string,
  questionId: string,
  answer: string,
  dbx: DbOrTx = defaultDb,
): Promise<AnalysisRequestResult> => {
  const text = cleanText(answer, ANALYSIS_INPUT_LIMITS.answerChars);
  if (!text) return { ok: false, status: 400, error: "Write or pick an answer." };
  return requestAnalysis(
    userId,
    mealId,
    "answer",
    false,
    (meal) => {
      const questions = meal.questions ?? [];
      if (!questions.some((q) => q.id === questionId))
        return { ok: false, status: 404, error: "Question not found." };
      return {
        questions: questions.map((q) => (q.id === questionId ? { ...q, answer: text } : q)),
      };
    },
    dbx,
  );
};

/**
 * "Fix with a sentence": stores the correction ("it was chicken, not beef") and analyses again.
 * Items the person edited by hand stay unless replaceEdits is true.
 */
export const correctMeal = async (
  userId: string,
  mealId: string,
  correction: string,
  options: { replaceEdits?: boolean } = {},
  dbx: DbOrTx = defaultDb,
): Promise<AnalysisRequestResult> => {
  const text = cleanText(correction, ANALYSIS_INPUT_LIMITS.correctionChars);
  if (!text) return { ok: false, status: 400, error: "Write what to change." };
  return requestAnalysis(
    userId,
    mealId,
    "correction",
    !!options.replaceEdits,
    (meal) => ({
      corrections: [...(meal.corrections ?? []), { text, at: new Date().toISOString() }].slice(-10),
    }),
    dbx,
  );
};

/** Analyses the meal again with what it already has (after a failure, or to start over). */
export const retryAnalysis = async (
  userId: string,
  mealId: string,
  options: { replaceEdits?: boolean } = {},
  dbx: DbOrTx = defaultDb,
): Promise<AnalysisRequestResult> =>
  requestAnalysis(userId, mealId, "retry", !!options.replaceEdits, () => ({}), dbx);
