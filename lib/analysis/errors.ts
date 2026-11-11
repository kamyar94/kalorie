// The error a meal card shows when its analysis stops or waits (meals.error {kind, message}).
// kind is an AiErrorKind (lib/ai/errors.ts) or one of the analysis' own codes below; the screens
// link to the AI settings for the kinds needsAiSettings lists (no-key, auth, quota, config).
//   no-key      no API key saved               auth        the provider refused the key
//   quota       no credit or quota left        refusal     the model declined the photos
//   not-food    the photos (or the words of a text meal) show no food
//   timeout     the provider took too long
//   no-photos   the photo files are missing    internal    anything unexpected
import { isAiError, isRetryableAiError, type AiErrorKind } from "@/lib/ai/errors";
import type { NotFoodKind } from "@/lib/contracts/analysis";

import { NOT_FOOD_DETAIL } from "./not-food";

export type MealErrorKind = AiErrorKind | "not-food" | "no-photos" | "internal";

/** notFoodKind: for "not-food", what the analysis says it is (lib/analysis/not-food.ts). */
export type MealError = { kind: MealErrorKind; message: string; notFoodKind?: NotFoodKind };

/** The detail a not-food message adds: what the photo seems to show. */
export const notFoodPhotoDetail = (title: string) => `${NOT_FOOD_DETAIL} ${title}.`;

const MESSAGES: Record<MealErrorKind, string> = {
  "no-key": "Add an API key in the AI settings so Kal can analyse your photos.",
  auth: "The AI provider did not accept your API key. Check or replace it in the AI settings.",
  quota: "Your AI provider account has no credit or quota left. Check it, then try again.",
  config: "AI analysis is not set up on this server yet. Ask the admin, or add the items by hand.",
  refusal: "The AI model declined to analyse these photos. Add the items by hand or try again.",
  "not-food":
    "These photos do not seem to show food or drink. Retake them or add the items by hand.",
  "no-photos": "The photos of this meal could not be read. Add the items by hand.",
  timeout: "The AI provider took too long to answer.",
  "rate-limit": "The AI provider's rate limit was reached.",
  "local-rate-limit": "Too many AI requests in a short time.",
  overloaded: "The AI provider is busy right now.",
  server: "The AI provider had a problem.",
  network: "The AI provider could not be reached.",
  "bad-request":
    "The AI provider refused the request. Check the model name in the AI settings, then try again.",
  incomplete: "The AI answer was cut off before it was complete.",
  "invalid-output": "The AI answer was not in the expected form.",
  internal: "Something went wrong while analysing this meal.",
};

/** Kinds worth another try later (the job queue backs off between tries). */
export const isRetryableMealError = (error: unknown, attempt: number) =>
  isRetryableAiError(error) ||
  // A reply that was cut off or not valid JSON gets one more try (with more room to answer).
  (isAiError(error) && ["incomplete", "invalid-output"].includes(error.kind) && attempt < 2) ||
  // Unexpected failures (database, files) get the queue's normal retries.
  !isAiError(error);

export const mealErrorKind = (error: unknown): MealErrorKind =>
  isAiError(error) ? error.kind : "internal";

/** The not-food message of a meal described in words (no photo). */
const NOT_FOOD_TEXT =
  "This description does not seem to name a food or drink. Fix it with a sentence or add the items by hand.";

/** The message for a meal that stopped; waiting adds when Kal tries again. */
export const mealError = (
  kind: MealErrorKind,
  options: {
    willRetry?: boolean;
    detail?: string;
    textOnly?: boolean;
    /** For "not-food": what it is instead, kept with the error. */
    notFoodKind?: NotFoodKind;
  } = {},
): MealError => {
  let message = kind === "not-food" && options.textOnly ? NOT_FOOD_TEXT : MESSAGES[kind];
  if (options.detail) message = `${message} ${options.detail}`;
  if (options.willRetry) message = `${message} Kal will try again shortly.`;
  else if (
    ![
      "no-key",
      "auth",
      "quota",
      "config",
      "not-food",
      "no-photos",
      "refusal",
      "bad-request",
    ].includes(kind)
  )
    message = `${message} Try again, or add the items by hand.`;
  return kind === "not-food" && options.notFoodKind
    ? { kind, message, notFoodKind: options.notFoodKind }
    : { kind, message };
};
