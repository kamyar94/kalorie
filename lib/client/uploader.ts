// Sends the device's queued meals (lib/client/capture-queue.ts) to POST /api/meals, oldest first.
// Runs when a meal is sent, when the app opens, when the device comes back online and when the
// page becomes visible; Background Sync asks the service worker to do the same where browsers
// support it. Repeat uploads are safe: the server returns the first copy for a known clientId.
//
// Browser only.
import type { CreateMealResponse } from "@/lib/contracts/meals";
import { uploadMeal, UploadError } from "@/lib/photos/client";

import { listQueued, photoBlob, putQueued, removeQueued, type QueuedMeal } from "./capture-queue";

export const SYNC_TAG = "cal-upload-queue";

export type UploadOutcome = "offline" | "retry" | "failed" | "signed-out";

/**
 * What a failed upload means: no connection (wait for "online"), a busy or failing server (try
 * again later), a refusal that will not change (the person decides), or a lost session.
 */
export const outcomeForStatus = (status: number): UploadOutcome => {
  if (status === 0) return "offline";
  if (status === 401) return "signed-out";
  if (status === 408 || status === 429 || status >= 500) return "retry";
  return "failed";
};

/** Wait before the next try after `attempts` failures: 15 s doubling, at most 10 minutes. */
export const backoffMs = (attempts: number) =>
  Math.min(15_000 * 2 ** Math.max(0, attempts - 1), 600_000);

export type FlushEvents = {
  onUploading?: (clientId: string) => void;
  onUploaded?: (clientId: string, response: CreateMealResponse) => void;
  onSettled?: (clientId: string, meal: QueuedMeal | null) => void;
};

const withLock = async <T>(run: () => Promise<T>): Promise<T | null> => {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks?.request) return run();
  return locks.request(SYNC_TAG, { ifAvailable: true }, async (lock) => (lock ? run() : null));
};

/**
 * Uploads every waiting meal of the account that is due. Stops at the first sign of being
 * offline. Returns how many went up, or null when another tab or the service worker is already
 * uploading.
 */
export const flushQueue = async (userId: string, events: FlushEvents = {}) =>
  withLock(async () => {
    let sent = 0;
    for (const meal of await listQueued(userId)) {
      if (meal.state !== "waiting" || meal.nextAttemptAt > Date.now()) continue;
      events.onUploading?.(meal.clientId);
      try {
        const response = await uploadMeal({
          photos: meal.photos.map(photoBlob),
          eatenAt: new Date(meal.eatenAt),
          tz: meal.tz,
          note: meal.note,
          clientId: meal.clientId,
        });
        await removeQueued(meal.clientId);
        sent += 1;
        events.onUploaded?.(meal.clientId, response);
        events.onSettled?.(meal.clientId, null);
      } catch (error) {
        const status = error instanceof UploadError ? error.status : 0;
        const outcome = outcomeForStatus(status);
        if (outcome === "offline" || outcome === "signed-out") {
          events.onSettled?.(meal.clientId, meal);
          break;
        }
        const attempts = meal.attempts + 1;
        const next: QueuedMeal =
          outcome === "failed"
            ? {
                ...meal,
                state: "failed",
                attempts,
                error: error instanceof Error ? error.message : "The upload was refused.",
              }
            : { ...meal, attempts, error: null, nextAttemptAt: Date.now() + backoffMs(attempts) };
        await putQueued(next);
        events.onSettled?.(meal.clientId, next);
      }
    }
    return sent;
  });

/** Asks the browser to run the service worker's upload when a connection is back. */
export const requestBackgroundSync = async () => {
  try {
    if (!("serviceWorker" in navigator)) return false;
    // ready never settles without a service worker, so give up after a moment.
    const registration = (await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ])) as
      (ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } }) | null;
    if (!registration?.sync) return false;
    await registration.sync.register(SYNC_TAG);
    return true;
  } catch {
    return false;
  }
};
