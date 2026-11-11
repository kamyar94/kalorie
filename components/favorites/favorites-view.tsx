"use client";

import { Copy, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { foodsLine } from "@/components/app/meal-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import type { FavoriteDto } from "@/lib/contracts/meals";
import { deviceTimeZone } from "@/lib/photos/client";
import { formatKcal } from "@/lib/ui/format";

import { FavoriteButton } from "./favorite-button";

/**
 * The Favorites page: every starred meal, most recently used first, with "Log again" (a copy of
 * the meal as it is now, at this moment, with Undo) and the star to take it off the list.
 */
export const FavoritesView = ({ initial }: { initial: FavoriteDto[] }) => {
  const router = useRouter();
  const { show } = useToast();
  const [favorites, setFavorites] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  const [shownInitial, setShownInitial] = useState(initial);
  if (initial !== shownInitial) {
    setShownInitial(initial);
    setFavorites(initial);
  }

  const fail = (title: string, error: unknown) =>
    show({ title, body: error instanceof Error ? error.message : undefined, tone: "error" });

  const logAgain = async (favorite: FavoriteDto) => {
    setBusy(`log:${favorite.mealId}`);
    try {
      const copy = await api.logFavorite(favorite.mealId, {
        eatenAt: new Date().toISOString(),
        tz: deviceTimeZone(),
      });
      show({
        title: `${favorite.title} logged`,
        tone: "success",
        action: {
          label: "Undo",
          onClick: () =>
            void api
              .deleteMeal(copy.id)
              .then(() => router.refresh())
              .catch((error) => fail("Not undone", error)),
        },
      });
      router.refresh();
    } catch (error) {
      fail("Not logged", error);
    } finally {
      setBusy(null);
    }
  };

  const unstar = async (favorite: FavoriteDto) => {
    setBusy(`star:${favorite.mealId}`);
    try {
      await api.patchMeal(favorite.mealId, { favorite: false });
      setFavorites((list) => list.filter((f) => f.mealId !== favorite.mealId));
      show({
        title: `${favorite.title} removed from your favorites`,
        action: {
          label: "Undo",
          onClick: () =>
            void api
              .patchMeal(favorite.mealId, { favorite: true })
              .then(() => router.refresh())
              .catch((error) => fail("Not undone", error)),
        },
      });
    } catch (error) {
      fail("Still a favorite", error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h1 className="text-title">Favorites</h1>
      <p className="text-caption text-muted mt-0.5">
        Meals you starred. Log one again with one tap, here or on Today.
      </p>
      {favorites.length ? (
        <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="favorites">
          {favorites.map((favorite) => (
            <Card as="li" key={favorite.mealId} className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="bg-surface-2 grid size-11 shrink-0 place-items-center rounded-xl text-2xl leading-none"
                >
                  {favorite.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-headline truncate" dir="auto">
                    <Link
                      href={`/meals/${favorite.mealId}`}
                      className="hover:underline focus-visible:underline"
                    >
                      {favorite.title}
                    </Link>
                  </h2>
                  <p className="text-caption text-muted truncate">
                    <span className="tabular">{formatKcal(favorite.kcal)}</span> kcal
                    {favorite.foods.length > 0 && ` · ${foodsLine(favorite.foods)}`}
                  </p>
                </div>
                <FavoriteButton
                  on
                  label={`Favorite: ${favorite.title}`}
                  busy={busy === `star:${favorite.mealId}`}
                  onToggle={() => void unstar(favorite)}
                />
              </div>
              <Button
                variant="secondary"
                fullWidth
                aria-label={`Log again now: ${favorite.title}`}
                loading={busy === `log:${favorite.mealId}`}
                disabled={busy !== null}
                onClick={() => void logAgain(favorite)}
              >
                <Copy aria-hidden className="size-4" /> Log again now
              </Button>
            </Card>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<Star className="size-7" />}
          title="No favorites yet"
          body="Open a meal and tap its star to keep it here."
        />
      )}
    </>
  );
};
