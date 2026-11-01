"use client";

import { RotateCcw, Settings, Trash2, Utensils } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useCapture } from "@/components/capture/capture-provider";
import { MealCard } from "@/components/app/meal-card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import type { MealSummaryDto } from "@/lib/contracts/meals";
import { localParts, slotFor } from "@/lib/meals/time";

const actionClass =
  "text-label bg-surface-2 hover:bg-surface-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5";

type Entry =
  | { kind: "server"; at: string; meal: MealSummaryDto }
  | {
      kind: "local";
      at: string;
      clientId: string;
      meal: Pick<
        MealSummaryDto,
        | "id"
        | "localTime"
        | "slot"
        | "title"
        | "status"
        | "photos"
        | "totals"
        | "itemCount"
        | "error"
      >;
      state: "waiting" | "uploading";
      failed: string | null;
    };

/**
 * The day's meals as a timeline of cards, oldest first: meals the server has, and meals still on
 * this device (waiting to upload or uploading).
 */
export const Timeline = ({
  date,
  today,
  meals,
}: {
  date: string;
  today: string;
  meals: MealSummaryDto[];
}) => {
  const capture = useCapture();
  const router = useRouter();
  const { show } = useToast();
  const [retrying, setRetrying] = useState<string | null>(null);

  const entries = useMemo(() => {
    const list: Entry[] = meals.map((meal) => ({ kind: "server", at: meal.eatenAt, meal }));
    const known = new Set(meals.map((m) => m.id));
    for (const meal of capture.uploaded.values())
      if (meal.localDate === date && !known.has(meal.id)) {
        known.add(meal.id);
        list.push({ kind: "server", at: meal.eatenAt, meal });
      }
    for (const queued of capture.queue) {
      const at = new Date(queued.eatenAt);
      const parts = localParts(at, queued.tz);
      if (parts.date !== date) continue;
      list.push({
        kind: "local",
        at: queued.eatenAt,
        clientId: queued.clientId,
        state: capture.uploading.has(queued.clientId) ? "uploading" : "waiting",
        failed: queued.state === "failed" ? (queued.error ?? "The upload was refused.") : null,
        meal: {
          id: queued.clientId,
          localTime: parts.time,
          slot: slotFor(at, queued.tz, capture.mealWindows ?? undefined),
          title: null,
          status: "analysing",
          photos: [],
          totals: {},
          itemCount: 0,
          error: null,
        },
      });
    }
    return list.sort((a, b) => a.at.localeCompare(b.at));
  }, [meals, capture.uploaded, capture.queue, capture.uploading, capture.mealWindows, date]);

  const retryServer = async (mealId: string) => {
    setRetrying(mealId);
    try {
      await api.retry(mealId);
      router.refresh();
    } catch (error) {
      show({ title: "Could not try again", body: (error as Error).message, tone: "error" });
    } finally {
      setRetrying(null);
    }
  };

  if (!entries.length)
    return (
      <EmptyState
        icon={<Utensils className="size-7" />}
        title={date === today ? "Nothing logged yet" : "No meals this day"}
        body={
          date === today
            ? "Press the camera button and take one to three photos of your plate. Cal does the rest."
            : "Meals you log for this day show up here."
        }
      />
    );

  return (
    <ol className="relative flex flex-col gap-3" data-testid="meal-list">
      {entries.map((entry, index) => {
        const last = index === entries.length - 1;
        const rail = (
          <>
            {!last && (
              <span
                aria-hidden
                className="bg-border absolute top-9 bottom-[-0.75rem] left-[5px] w-0.5"
              />
            )}
            <span
              aria-hidden
              className={
                "ring-bg absolute top-7 left-0 size-3 rounded-full ring-4 " +
                (entry.kind === "local"
                  ? "bg-surface-3"
                  : entry.meal.status === "failed"
                    ? "bg-danger"
                    : entry.meal.status === "needs_input"
                      ? "bg-carbs"
                      : entry.meal.status === "ready"
                        ? "bg-primary"
                        : "bg-surface-3")
              }
            />
          </>
        );
        if (entry.kind === "local")
          return (
            <li key={entry.clientId} className="relative pl-6">
              {rail}
              <MealCard
                meal={entry.failed ? { ...entry.meal, status: "failed" } : entry.meal}
                localState={entry.failed ? undefined : entry.state}
                previewUrl={capture.previews.get(entry.clientId)}
                detail={
                  entry.failed ??
                  (entry.state === "waiting" && !capture.online
                    ? "Sends when you are back online."
                    : undefined)
                }
                actions={
                  entry.failed ? (
                    <>
                      <button
                        type="button"
                        className={actionClass}
                        onClick={() => void capture.retry(entry.clientId)}
                      >
                        <RotateCcw aria-hidden className="size-4" /> Try again
                      </button>
                      <button
                        type="button"
                        className={actionClass}
                        onClick={() => void capture.discard(entry.clientId)}
                      >
                        <Trash2 aria-hidden className="size-4" /> Remove
                      </button>
                    </>
                  ) : undefined
                }
              />
            </li>
          );
        const { meal } = entry;
        return (
          <li key={meal.id} className="relative pl-6">
            {rail}
            <MealCard
              meal={meal}
              href={`/meals/${meal.id}`}
              detail={
                meal.status === "failed"
                  ? (meal.error?.message ?? "The analysis did not finish.")
                  : meal.status === "needs_input"
                    ? `${meal.openQuestions === 1 ? "A question" : `${meal.openQuestions} questions`} about this meal`
                    : undefined
              }
              actions={
                meal.status === "failed" ? (
                  meal.error?.settingsLink ? (
                    <Link href="/settings#ai" className={actionClass}>
                      <Settings aria-hidden className="size-4" /> Open AI settings
                    </Link>
                  ) : meal.source === "photo" ? (
                    <button
                      type="button"
                      className={actionClass}
                      disabled={retrying === meal.id}
                      onClick={() => void retryServer(meal.id)}
                    >
                      <RotateCcw aria-hidden className="size-4" /> Try again
                    </button>
                  ) : undefined
                ) : undefined
              }
            />
          </li>
        );
      })}
    </ol>
  );
};
