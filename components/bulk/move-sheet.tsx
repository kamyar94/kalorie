"use client";

import { Plus } from "lucide-react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { checkMove, type BulkState, type MoveTarget } from "@/lib/bulk/moves";
import { BULK } from "@/lib/bulk/rules";

import { photoCount, type BulkAsset } from "./bulk-meal-card";

/**
 * "Move n photos to" (board 47): every meal with its photos, time and room, and "A new meal". A
 * meal without room for the selection is shown but cannot be picked. The way to move photos
 * without dragging (keyboard and screen readers).
 */
export const MoveSheet = ({
  open,
  onOpenChange,
  state,
  assets,
  mealLabel,
  onMove,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: BulkState;
  assets: Record<string, BulkAsset>;
  /** "08:12 · Breakfast" for a meal. */
  mealLabel: (mealId: string) => string;
  onMove: (to: MoveTarget) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) => {
  const ids = state.selected;
  const rows = state.meals
    .map((meal, i) => ({ meal, number: i + 1, check: checkMove(state, ids, meal.id) }))
    .filter(({ check }) => check.ok || check.reason !== "same");
  const tooMany = ids.length > BULK.perMeal;
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Move ${photoCount(ids.length)} to`}
      elevated
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <ul className="-mt-1" data-testid="move-targets">
        {rows.map(({ meal, number, check }) => {
          const count = meal.photoIds.length;
          const room =
            count >= BULK.perMeal
              ? "full"
              : `${count} of ${BULK.perMeal} photos${
                  !check.ok && check.reason === "full" ? `: room for ${check.room}` : ""
                }`;
          return (
            <li key={meal.id} className="border-border border-t first:border-t-0">
              <button
                type="button"
                disabled={!check.ok}
                onClick={() => onMove(meal.id)}
                className="hover:bg-surface-2 flex min-h-15 w-full items-center gap-2.5 rounded-xl py-1.5 text-left disabled:opacity-60 disabled:hover:bg-transparent"
              >
                <span aria-hidden className="flex shrink-0 gap-1">
                  {meal.photoIds.map((id) =>
                    assets[id] ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local preview
                      <img
                        key={id}
                        src={assets[id].url}
                        alt=""
                        className="size-9 rounded-[0.5625rem] object-cover"
                      />
                    ) : null,
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-label block">Meal {number}</span>
                  <span className="text-caption text-muted block">
                    {mealLabel(meal.id)} · {room}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        <li className="border-border border-t">
          <button
            type="button"
            disabled={tooMany}
            onClick={() => onMove("new")}
            className="text-label text-primary hover:bg-surface-2 flex min-h-14 w-full items-center gap-2 rounded-xl text-left disabled:opacity-60"
          >
            <Plus aria-hidden className="size-4.5" /> A new meal
          </button>
          {tooMany && (
            <p className="text-caption text-muted pb-1">
              A meal holds up to {BULK.perMeal} photos. Select {BULK.perMeal} or fewer.
            </p>
          )}
        </li>
      </ul>
    </BottomSheet>
  );
};
