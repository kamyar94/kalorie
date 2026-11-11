"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import type { FavoriteDto } from "@/lib/contracts/meals";
import { deviceTimeZone } from "@/lib/photos/client";
import { oneTapTime } from "@/lib/ui/log-time";

/**
 * "Log a favorite again" on Today: one chip per favorite (most recently used first, at most six),
 * with its cover emoji. A tap logs a copy of the meal as it is now, at once (or at 12:00 of the day
 * shown when that is an earlier day), with Undo. Nothing shows without favorites.
 */
export const FavoriteChips = ({
  favorites,
  date,
  today,
}: {
  favorites: FavoriteDto[];
  date: string;
  today: string;
}) => {
  const router = useRouter();
  const { show } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!favorites.length) return null;

  const log = async (favorite: FavoriteDto) => {
    const tz = deviceTimeZone();
    setBusy(favorite.mealId);
    try {
      const copy = await api.logFavorite(favorite.mealId, {
        eatenAt: oneTapTime(date, today, tz),
        tz,
      });
      router.refresh();
      show({
        title: `${favorite.title} logged`,
        tone: "success",
        action: {
          label: "Undo",
          onClick: () =>
            void api
              .deleteMeal(copy.id)
              .then(() => router.refresh())
              .catch((error) =>
                show({ title: "Not undone", body: (error as Error).message, tone: "error" }),
              ),
        },
      });
    } catch (error) {
      show({ title: "Not logged", body: (error as Error).message, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      aria-labelledby="favorites-heading"
      className="flex flex-col gap-2"
      data-testid="favorite-chips"
    >
      <h2 id="favorites-heading" className="text-body font-semibold">
        Log a favorite again
      </h2>
      <div className="flex flex-wrap gap-2">
        {favorites.map((favorite) => (
          <button
            key={favorite.mealId}
            type="button"
            disabled={busy !== null}
            aria-busy={busy === favorite.mealId || undefined}
            onClick={() => void log(favorite)}
            className="text-label border-border bg-surface text-text hover:bg-surface-2 inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border px-3.5 disabled:opacity-60"
          >
            <span aria-hidden className="shrink-0">
              {favorite.emoji}
            </span>
            <span className="min-w-0 truncate" dir="auto">
              {favorite.title}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
};
