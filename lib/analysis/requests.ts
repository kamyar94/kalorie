// What the meal screen asks of the analysis (CONTRACT: lib/contracts/analysis.ts): answer a
// question, fix the meal with a sentence, or try again. Each stores the person's input on the meal,
// sets it "queued" and enqueues an analysis in the same transaction; the worker reads the input
// from the meal row. Scoped by user id: another person's meal behaves like a missing one.
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { mealPhotos, meals } from "@/db/schema";
import { ANALYSED_SOURCES } from "@/lib/contracts/meals";
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
 * Shared steps: rate limit, the meal (locked), its photos (or its description, for a text meal),
 * the change, status queued, the job. change returns the new column values, or an error result.
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
    // A text meal is analysed from its description; other meals need photos.
    if (!Number(photos[0]?.n) && !(meal.source === "text" && meal.note?.trim()))
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

/** Failures that a new key can fix: no key, a refused key, or an account out of credit. */
const KEY_FAILURE_KINDS = ["no-key", "auth", "quota"];
/** How far back, and how many meals at most, a saved key analyses again. */
const KEY_RETRY_DAYS = 7;
const KEY_RETRY_MAX = 10;

/**
 * After the person saves an AI key: analyses again their photo and text meals of the last week
 * that stopped for a key problem, newest first. Returns how many were queued.
 */
export const retryKeyFailures = async (
  userId: string,
  dbx: DbOrTx = defaultDb,
): Promise<number> => {
  if (!isUuid(userId)) return 0;
  const since = new Date(Date.now() - KEY_RETRY_DAYS * 86_400_000);
  const failed = await dbx
    .select({ id: meals.id })
    .from(meals)
    .where(
      and(
        eq(meals.userId, userId),
        eq(meals.status, "failed"),
        inArray(meals.source, [...ANALYSED_SOURCES]),
        isNull(meals.deletedAt),
        gte(meals.createdAt, since),
        inArray(sql<string>`${meals.error}->>'kind'`, KEY_FAILURE_KINDS),
      ),
    )
    .orderBy(desc(meals.createdAt))
    .limit(KEY_RETRY_MAX);
  let queued = 0;
  for (const { id } of failed) {
    const result = await requestAnalysis(userId, id, "retry", false, () => ({}), dbx);
    if (result.ok) queued += 1;
  }
  return queued;
};

/** Analyses the meal again with what it already has (after a failure, or to start over). */
export const retryAnalysis = async (
  userId: string,
  mealId: string,
  options: { replaceEdits?: boolean } = {},
  dbx: DbOrTx = defaultDb,
): Promise<AnalysisRequestResult> =>
  requestAnalysis(userId, mealId, "retry", !!options.replaceEdits, () => ({}), dbx);
