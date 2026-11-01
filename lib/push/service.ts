// Notifications (docs/DESIGN.md section 9): the person's push subscriptions, and the worker's
// "send-push" job for "analysis ready" and "a question about your meal". Off until the person
// turns them on in Settings (users.notifications); a finished analysis queues one job, the worker
// sends it to every subscription of the person and removes subscriptions the push service says
// are gone (404, 410) or that keep failing.
import { and, eq, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { meals, pushSubscriptions, users } from "@/db/schema";
import type { AnalysisFinishedEvent } from "@/lib/contracts/analysis";
import type { PushMessage } from "@/lib/contracts/integrations";
import { MEAL_SLOT_LABELS } from "@/lib/contracts/meals";
import { enqueueJob } from "@/lib/queue/queue";
import { JobError, type JobHandler } from "@/lib/queue/worker";

import { allowedEndpoint, vapidConfig } from "./config";
import { sendPush } from "./webpush";

export const PUSH_JOB = "send-push";
/** A subscription that failed this many times in a row is dropped. */
export const MAX_PUSH_FAILURES = 5;

export type PushEvent = "ready" | "question";
export type PushJobPayload = { userId: string; mealId: string; event: PushEvent };

const isB64url = (value: unknown, bytes: number): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9_-]+={0,2}$/.test(value) &&
  Buffer.from(value, "base64url").length === bytes;

export type SubscriptionInput = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };

export type SubscribeResult = { ok: true } | { ok: false; status: 400 | 503; error: string };

/**
 * Stores the browser's subscription for the person. An endpoint already stored for another
 * account moves to this one (the device signed in as someone else).
 */
export const saveSubscription = async (
  userId: string,
  input: SubscriptionInput,
  userAgent: string | null,
  dbx: DbOrTx = defaultDb,
): Promise<SubscribeResult> => {
  if (!vapidConfig())
    return { ok: false, status: 503, error: "Notifications are not set up on this server." };
  const endpoint = typeof input?.endpoint === "string" ? input.endpoint : "";
  const p256dh = input?.keys?.p256dh;
  const auth = input?.keys?.auth;
  if (!allowedEndpoint(endpoint) || !isB64url(p256dh, 65) || !isB64url(auth, 16))
    return { ok: false, status: 400, error: "This browser's subscription cannot be used." };
  if (Buffer.from(p256dh, "base64url")[0] !== 4)
    return { ok: false, status: 400, error: "This browser's subscription cannot be used." };
  const values = {
    userId,
    p256dh,
    auth,
    userAgent: userAgent?.slice(0, 200) ?? null,
    failures: 0,
  };
  await dbx
    .insert(pushSubscriptions)
    .values({ endpoint, ...values })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values });
  return { ok: true };
};

/** Removes one of the person's subscriptions (another person's endpoint is left alone). */
export const removeSubscription = async (
  userId: string,
  endpoint: unknown,
  dbx: DbOrTx = defaultDb,
) => {
  if (typeof endpoint !== "string" || !endpoint) return false;
  const rows = await dbx
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .returning({ id: pushSubscriptions.id });
  return rows.length > 0;
};

export const countSubscriptions = async (userId: string, dbx: DbOrTx = defaultDb) =>
  Number(
    (
      await dbx
        .select({ n: sql<number>`count(*)::int` })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))
    )[0]?.n ?? 0,
  );

export type NotifyResult = { sent: number; removed: number; failed: number; retry: number };

/** Sends a message to every subscription of the person. */
export const notifyUser = async (
  userId: string,
  message: PushMessage,
  dbx: DbOrTx = defaultDb,
): Promise<NotifyResult> => {
  const keys = vapidConfig();
  const result: NotifyResult = { sent: 0, removed: 0, failed: 0, retry: 0 };
  if (!keys) return result;
  const subscriptions = await dbx
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  for (const subscription of subscriptions) {
    const remove = () =>
      dbx.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
    if (!allowedEndpoint(subscription.endpoint)) {
      await remove();
      result.removed += 1;
      continue;
    }
    const sent = await sendPush(subscription, message, keys, {
      topic: message.tag,
      urgency: "normal",
    });
    if (sent.status >= 200 && sent.status < 300) {
      result.sent += 1;
      await dbx
        .update(pushSubscriptions)
        .set({ failures: 0, lastSuccessAt: new Date() })
        .where(eq(pushSubscriptions.id, subscription.id));
    } else if (sent.expired || subscription.failures + 1 >= MAX_PUSH_FAILURES) {
      await remove();
      result.removed += 1;
    } else {
      await dbx
        .update(pushSubscriptions)
        .set({ failures: subscription.failures + 1 })
        .where(eq(pushSubscriptions.id, subscription.id));
      if (sent.retry) result.retry += 1;
      else result.failed += 1;
    }
  }
  return result;
};

/** The notification text for a finished analysis, from the meal as it is now. */
export const messageFor = async (
  payload: PushJobPayload,
  dbx: DbOrTx = defaultDb,
): Promise<PushMessage | null> => {
  const meal = (
    await dbx
      .select()
      .from(meals)
      .where(and(eq(meals.id, payload.mealId), eq(meals.userId, payload.userId)))
      .limit(1)
  )[0];
  if (!meal || meal.deletedAt) return null;
  const title = meal.title ?? MEAL_SLOT_LABELS[meal.slot];
  const url = `/meals/${meal.id}`;
  if (payload.event === "question") {
    const question = (meal.questions ?? []).find((q) => !q.answer);
    if (!question || meal.status !== "needs_input") return null;
    return {
      title: "A question about your meal",
      body: `${title}: ${question.text}`.slice(0, 180),
      url,
      tag: `meal-${meal.id}`,
    };
  }
  if (meal.status !== "ready") return null;
  const kcal =
    typeof meal.totals?.energy === "number" ? `, about ${Math.round(meal.totals.energy)} kcal` : "";
  return {
    title: "Your meal is analysed",
    body: `${title}${kcal}. Tap to check the details.`.slice(0, 180),
    url,
    tag: `meal-${meal.id}`,
  };
};

const isPayload = (value: unknown): value is PushJobPayload => {
  const p = value as Partial<PushJobPayload> | null;
  return (
    !!p &&
    typeof p.userId === "string" &&
    typeof p.mealId === "string" &&
    (p.event === "ready" || p.event === "question")
  );
};

/** The worker's "send-push" job. */
export const sendPushHandler: JobHandler = async (payload) => {
  if (!isPayload(payload)) throw new JobError("Invalid send-push payload.", { retry: false });
  const message = await messageFor(payload);
  if (!message) return { skipped: "meal changed" };
  const result = await notifyUser(payload.userId, message);
  if (result.retry > 0 && result.sent === 0) throw new JobError("Push service busy.");
  return result;
};

/**
 * Listener for finished analyses (lib/analysis/events.ts): queues a notification when the person
 * turned that kind on and has a subscription.
 */
export const onAnalysisFinished = async (event: AnalysisFinishedEvent, dbx: DbOrTx = defaultDb) => {
  const pushEvent: PushEvent | null =
    event.status === "needs_input" && event.questions > 0
      ? "question"
      : event.status === "ready"
        ? "ready"
        : null;
  if (!pushEvent || !vapidConfig()) return;
  const prefs = (
    await dbx
      .select({ n: users.notifications })
      .from(users)
      .where(eq(users.id, event.userId))
      .limit(1)
  )[0]?.n;
  const wanted = pushEvent === "ready" ? prefs?.analysisReady === true : prefs?.questions === true;
  if (!wanted || !(await countSubscriptions(event.userId, dbx))) return;
  await enqueueJob(
    PUSH_JOB,
    { userId: event.userId, mealId: event.mealId, event: pushEvent } satisfies PushJobPayload,
    { userId: event.userId, maxAttempts: 3, dedupeKey: `push:${event.mealId}:${pushEvent}` },
    dbx,
  );
};
