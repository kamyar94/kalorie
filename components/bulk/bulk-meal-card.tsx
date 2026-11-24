"use client";

import { Check, Clock, Ellipsis } from "lucide-react";
import { useId } from "react";

import { cn } from "@/components/ui/cn";
import type { BulkMeal } from "@/lib/bulk/moves";
import { BULK } from "@/lib/bulk/rules";
import type { TimeProblem } from "@/lib/bulk/times";
import { UPLOAD_LIMITS } from "@/lib/contracts/meals";

/** A photo of the batch as the screen shows it. */
export type BulkAsset = {
  id: string;
  /** Object URL of its small preview. */
  url: string;
  /** "08:12", or null with no time taken. */
  time: string | null;
};

/** What a drag over this meal would do: move the photos here, or not (the meal is full). */
export type DropHint = { kind: "ok"; count: number } | { kind: "full" } | null;

export const photoCount = (n: number) => `${n} ${n === 1 ? "photo" : "photos"}`;

/** "No time on this photo, so the meal starts at the time you picked it. Check the time." */
export const noTimeWords = (count: number, earlierDay: boolean) =>
  `No time on ${count === 1 ? "this photo" : "these photos"}, so the meal starts ${
    earlierDay ? "at 12:00 of this day" : `at the time you picked ${count === 1 ? "it" : "them"}`
  }. Check the time.`;

/**
 * One meal found on "Add photos" (board 45): its number, how many photos it holds, the photos
 * (toggle buttons: a tap selects; touch and hold, or drag with a mouse, moves them), the time chip
 * that opens the When sheet, a note for the AI and the More menu. The whole card is a drop target.
 */
export const BulkMealCard = ({
  meal,
  number,
  assets,
  selected,
  lifted,
  timeLabel,
  slotLabel,
  noTime,
  earlierDay,
  problem,
  drop,
  onPhotoPointerDown,
  onPhotoClick,
  onTime,
  onNote,
  onMore,
}: {
  meal: BulkMeal;
  number: number;
  assets: Record<string, BulkAsset>;
  selected: ReadonlySet<string>;
  /** Photos being dragged right now (shown faded where they were). */
  lifted: ReadonlySet<string>;
  timeLabel: string;
  slotLabel: string;
  /** No photo has a time taken and none was set: the time is a guess to check. */
  noTime: boolean;
  /** The screen opened for an earlier day (a guess is 12:00 of it). */
  earlierDay: boolean;
  problem: TimeProblem | null;
  drop: DropHint;
  onPhotoPointerDown: (photoId: string, event: React.PointerEvent) => void;
  onPhotoClick: (photoId: string, additive: boolean) => void;
  onTime: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onNote: (note: string) => void;
  onMore: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) => {
  const noteId = useId();
  const count = meal.photoIds.length;
  const full = count >= BULK.perMeal;
  return (
    <section
      aria-labelledby={`${noteId}-title`}
      data-drop={meal.id}
      data-testid="bulk-meal"
      className={cn(
        "bg-surface shadow-card flex flex-col gap-2.5 rounded-[var(--radius-card)] border p-3.5 transition-colors",
        drop?.kind === "ok"
          ? "border-primary bg-primary-soft border-2 border-dashed"
          : drop?.kind === "full"
            ? "bg-warning-soft border-on-warning-soft border-2 border-dashed"
            : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        <h3 id={`${noteId}-title`} className="text-headline min-w-0 flex-1">
          Meal {number}
        </h3>
        <span
          className={cn("text-caption", full ? "text-on-warning-soft font-semibold" : "text-muted")}
          data-testid="bulk-meal-count"
        >
          {count} of {BULK.perMeal} photos{full ? " · full" : ""}
        </span>
        <button
          type="button"
          aria-label={`More for meal ${number}`}
          aria-haspopup="dialog"
          onClick={onMore}
          className="bg-surface-2 hover:bg-surface-3 grid size-11 shrink-0 place-items-center rounded-full"
        >
          <Ellipsis aria-hidden className="size-5" />
        </button>
      </div>

      <ul className="flex flex-wrap gap-2" aria-label={`Photos of meal ${number}`}>
        {meal.photoIds.map((id) => {
          const asset = assets[id];
          if (!asset) return null;
          const on = selected.has(id);
          return (
            <li key={id}>
              <button
                type="button"
                aria-pressed={on}
                aria-label={
                  asset.time ? `Photo taken at ${asset.time}` : "Photo with no time taken"
                }
                data-photo-id={id}
                onPointerDown={(event) => onPhotoPointerDown(id, event)}
                onClick={(event) =>
                  onPhotoClick(id, event.shiftKey || event.ctrlKey || event.metaKey)
                }
                onContextMenu={(event) => event.preventDefault()}
                className={cn(
                  "bg-surface-3 relative block size-23 shrink-0 overflow-hidden rounded-[0.875rem] select-none [-webkit-touch-callout:none]",
                  on && "outline-primary outline-3 outline-offset-2",
                  lifted.has(id) && "opacity-35",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                <img
                  src={asset.url}
                  alt=""
                  draggable={false}
                  className="pointer-events-none size-full object-cover"
                />
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full border-2",
                    on ? "border-primary bg-primary text-on-primary" : "border-white bg-black/45",
                  )}
                >
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
                <span
                  aria-hidden
                  className="absolute bottom-1.5 left-1.5 rounded-full bg-black/65 px-1.5 text-[0.6875rem] leading-4 font-semibold text-white"
                >
                  {asset.time ?? "No time"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {drop?.kind === "ok" && (
        <p className="text-label text-on-primary-soft">
          Drop to move {photoCount(drop.count)} here
        </p>
      )}
      {drop?.kind === "full" && (
        <p className="text-label text-on-warning-soft">
          Meal {number} already has {BULK.perMeal} photos. Drop on another meal or on New meal.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={`Change the time of meal ${number}: ${timeLabel} · ${slotLabel}`}
          data-time-chip={meal.id}
          onClick={onTime}
          className={cn(
            "text-label inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5",
            noTime || problem
              ? "bg-warning-soft text-on-warning-soft border-on-warning-soft"
              : "border-border bg-surface-2 hover:bg-surface-3",
          )}
        >
          <Clock aria-hidden className="size-4" />
          {timeLabel} · {slotLabel}
        </button>
      </div>
      {problem ? (
        <p className="text-caption text-danger font-semibold">
          {problem === "future"
            ? "That time is still to come. Change it."
            : "Kal logs meals of the last year. Change the time."}
        </p>
      ) : (
        noTime && (
          <p className="text-caption text-on-warning-soft">{noTimeWords(count, earlierDay)}</p>
        )
      )}

      <label htmlFor={noteId} className="sr-only">
        Note for meal {number}
      </label>
      <textarea
        id={noteId}
        dir="auto"
        rows={1}
        maxLength={UPLOAD_LIMITS.maxNoteChars}
        value={meal.note}
        onChange={(event) => onNote(event.target.value)}
        placeholder="Add a note for the AI (optional)"
        className="border-border bg-bg text-body placeholder:text-muted [field-sizing:content] min-h-11 w-full resize-none rounded-[0.875rem] border px-3 py-2.5"
      />
    </section>
  );
};
