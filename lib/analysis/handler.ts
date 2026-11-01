// The "analyze-meal" job handler (CONTRACT: lib/contracts/analysis.ts), registered in
// worker/handlers.ts. It moves the meal through its statuses and decides about retries:
//   queued -> analysing -> ready | needs_input            (lib/analysis/pipeline.ts did the work)
//   analysing -> queued (error says "will try again")     provider busy, rate limit, timeout,
//                                                         network, a cut-off or malformed reply
//                                                         (once), unexpected errors; the queue
//                                                         backs off (15 s, 30 s, 1 min) and the
//                                                         provider's Retry-After is respected
//   analysing -> failed (error with a clear message)      missing or refused key, no credit,
//                                                         refusal, not food, unreadable photos,
//                                                         or the last attempt
// Permanent outcomes end the job normally (result.errorKind says why); only retries throw.
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { meals } from "@/db/schema";
import { isAiError } from "@/lib/ai/errors";
import { isAnalyzeMealPayload, type AnalyzeMealResult } from "@/lib/contracts/analysis";
import { JobError, type JobHandler } from "@/lib/queue/worker";

import {
  isRetryableMealError,
  mealError,
  mealErrorKind,
  type MealError,
  type MealErrorKind,
} from "./errors";
import { emitAnalysisFinished } from "./events";
import { analyseMeal, NoPhotosError } from "./pipeline";

const setMealState = async (
  userId: string,
  mealId: string,
  state: { status: "queued" | "analysing" | "failed"; error: MealError | null },
) => {
  const rows = await db
    .update(meals)
    .set(state)
    .where(and(eq(meals.id, mealId), eq(meals.userId, userId), isNull(meals.deletedAt)))
    .returning({ id: meals.id });
  return rows.length > 0;
};

export const analyzeMealHandler: JobHandler = async (
  payload,
  context,
): Promise<AnalyzeMealResult> => {
  if (!isAnalyzeMealPayload(payload))
    throw new JobError("Invalid analyze-meal payload.", { retry: false });
  const { userId, mealId } = payload;
  if (!(await setMealState(userId, mealId, { status: "analysing", error: null })))
    throw new JobError("The meal no longer exists.", { retry: false });
  context.log(`analysing meal ${mealId} (${payload.reason}, attempt ${context.attempt})`);

  try {
    const outcome = await analyseMeal(payload, {
      attempt: context.attempt,
      signal: context.signal,
      log: context.log,
    });
    if (outcome.missing) throw new JobError("The meal no longer exists.", { retry: false });
    if (outcome.error) context.log(`meal ${mealId}: ${outcome.error.kind}`);
    // A newer request is already waiting: the listener hears about that run instead.
    if (outcome.status !== "queued")
      await emitAnalysisFinished(
        {
          userId,
          mealId,
          status: outcome.status,
          questions: outcome.questions,
          errorKind: outcome.error?.kind ?? null,
        },
        context.log,
      );
    return {
      mealId,
      status: outcome.status,
      items: outcome.items,
      questions: outcome.questions,
      ...(outcome.error ? { errorKind: outcome.error.kind } : {}),
    };
  } catch (error) {
    if (error instanceof JobError) throw error;
    const kind: MealErrorKind =
      error instanceof NoPhotosError
        ? "no-photos"
        : context.signal.aborted && !isAiError(error)
          ? "timeout"
          : mealErrorKind(error);
    const retry =
      !(error instanceof NoPhotosError) &&
      isRetryableMealError(error, context.attempt) &&
      context.attempt < context.maxAttempts;
    const message = error instanceof Error ? error.message : String(error);

    if (retry) {
      await setMealState(userId, mealId, {
        status: "queued",
        error: mealError(kind, { willRetry: true }),
      });
      const retryAfter = isAiError(error) ? error.retryAfter : undefined;
      throw new JobError(`${kind}: ${message}`, {
        retryAfterMs: retryAfter ? retryAfter * 1000 : undefined,
      });
    }
    await setMealState(userId, mealId, { status: "failed", error: mealError(kind) });
    context.log(`meal ${mealId} failed: ${kind}: ${message}`);
    await emitAnalysisFinished(
      { userId, mealId, status: "failed", questions: 0, errorKind: kind },
      context.log,
    );
    return { mealId, status: "failed", items: 0, questions: 0, errorKind: kind };
  }
};
