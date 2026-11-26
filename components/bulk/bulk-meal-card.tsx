"use client";

import { Check, Clock, Ellipsis, Loader2, Plus } from "lucide-react";
import { useId } from "react";

import { cn } from "@/components/ui/cn";
import { HoldRing } from "@/components/ui/hold-ring";
import type { PressView } from "@/components/ui/use-hold-press";
import type { BulkMeal } from "@/lib/bulk/moves";
import { BULK } from "@/lib/bulk/rules";
import type { TimeProblem } from "@/lib/bulk/times";
import { UPLOAD_LIMITS } from "@/lib/contracts/meals";

/** A photo of the batch as the screen shows it. */
export type BulkAsset = {
  id: string;
  /** Object URL of its small preview. */
  url: string;
  /** Object URL of the photo as it will be sent (for the viewer). */
  fullUrl: string;
  /** "08:12", or null with no time taken. */
  time: string | null;
};

/** What a drag over this meal would do: move the photos here, or not (the meal is full). */
export type DropHint = { kind: "ok"; count: number } | { kind: "full" } | null;

export const photoCount = (n: number) => `${n} ${n === 1 ? "photo" : "photos"}`;

/** "No time on this photo, so the meal starts at the time you picked it. Check the time." */
export const noTimeWords = (count: number, earlierDay: boolean, anchored = false) =>
  `No time on ${count === 1 ? "this photo" : "these photos"}, so the meal starts ${
    anchored
      ? "at the time of the meal before it"
      : earlierDay
        ? "at 12:00 of this day"
        : `at the time you picked ${count === 1 ? "it" : "them"}`
  }. Check the time.`;

/** "Photo 2, taken 12:48: open it larger" (the cover says so when the meal has more than one). */
export const photoLabel = (n: number, time: string | null, cover: boolean) =>
  `Photo ${n}${cover ? ", the cover" : ""}, ${time ? `taken ${time}` : "no time taken"}: open it larger`;

/**
 * One meal found on "Add photos" (boards 45, 48 and 50): its number, how many photos it holds,
 * the photos (a tap opens one larger; touch and hold makes it the cover, or drags it once it
 * moves; the circle on its corner selects it), "+ Add" for more photos from the gallery while it
 * has room, the time chip that opens the When sheet, a note for the AI and the More menu. The
 * whole card is a drop target.
 */
export const BulkMealCard = ({
  meal,
  number,
  assets,
  selected,
  lifted,
  press,
  timeLabel,
  slotLabel,
  noTime,
  earlierDay,
  problem,
  drop,
  reading,
  onPhotoPointerDown,
  onOpen,
  onSelect,
  onAdd,
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
  /** The photo being held, with its ring. */
  press: PressView | null;
  timeLabel: string;
  slotLabel: string;
  /** No photo has a time taken and none was set: the time is a guess to check. */
  noTime: boolean;
  /** The screen opened for an earlier day (a guess is 12:00 of it). */
  earlierDay: boolean;
  problem: TimeProblem | null;
  drop: DropHint;
  /** Photos picked with "+ Add" for this meal, being read now. */
  reading: { done: number; total: number } | null;
  onPhotoPointerDown: (photoId: string, event: React.PointerEvent) => void;
  onOpen: (photoId: string) => void;
  /** additive: Shift or Ctrl on a computer, which only adds to the selection. */
  onSelect: (photoId: string, additive: boolean) => void;
  onAdd: () => void;
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
        {meal.photoIds.map((id, index) => {
          const asset = assets[id];
          if (!asset) return null;
          const on = selected.has(id);
          const cover = index === 0 && count > 1;
          const held = press?.id === id && press.held;
          return (
            <li key={id} className="relative size-23 shrink-0">
              <button
                type="button"
                aria-label={photoLabel(index + 1, asset.time, cover)}
                data-photo-id={id}
                onPointerDown={(event) => onPhotoPointerDown(id, event)}
                onClick={(event) => {
                  if (event.shiftKey || event.ctrlKey || event.metaKey) onSelect(id, true);
                  else onOpen(id);
                }}
                onContextMenu={(event) => event.preventDefault()}
                className={cn(
                  "bg-surface-3 relative block size-full overflow-hidden rounded-[0.875rem] transition-transform select-none [-webkit-touch-callout:none]",
                  (on || cover) && "outline-primary outline-3 outline-offset-2",
                  held && "outline-primary scale-[1.06] outline-3 outline-offset-4",
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
                {cover && (
                  <span
                    aria-hidden
                    className="bg-primary text-on-primary absolute top-1.5 left-1.5 rounded-full px-1.5 text-[0.6875rem] leading-4 font-bold"
                  >
                    Cover
                  </span>
                )}
                <span
                  aria-hidden
                  className="absolute bottom-1.5 left-1.5 rounded-full bg-black/65 px-1.5 text-[0.6875rem] leading-4 font-semibold text-white"
                >
                  {asset.time ?? "No time"}
                </span>
              </button>
              {press?.id === id && (
                <HoldRing startedAt={press.startedAt} held={press.held} className="z-[1]" />
              )}
              {/* Its own 44 px target on the photo's corner; the circle shows the selection. */}
              <button
                type="button"
                aria-label={`Select photo ${index + 1}`}
                aria-pressed={on}
                data-select-id={id}
                onClick={(event) => onSelect(id, event.shiftKey || event.ctrlKey || event.metaKey)}
                className="absolute top-0 right-0 z-[2] grid size-11 place-items-start justify-items-end p-1.5"
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid size-6 place-items-center rounded-full border-2",
                    on ? "border-primary bg-primary text-on-primary" : "border-white bg-black/45",
                  )}
                >
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
              </button>
            </li>
          );
        })}
        {reading ? (
          <li>
            <div
              role="progressbar"
              aria-label={`Reading ${photoCount(reading.total)} for meal ${number}`}
              aria-valuemin={0}
              aria-valuemax={reading.total}
              aria-valuenow={reading.done}
              className="border-border text-muted flex size-23 flex-col items-center justify-center gap-1 rounded-[0.875rem] border-2 border-dashed text-xs font-bold"
              data-testid="bulk-meal-reading"
            >
              <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
              <span className="tabular">
                {reading.done} of {reading.total}
              </span>
            </div>
          </li>
        ) : (
          !full && (
            <li>
              <button
                type="button"
                aria-label={`Add photos to meal ${number} from the gallery`}
                onClick={onAdd}
                className="border-border text-muted hover:bg-surface-2 flex size-23 flex-col items-center justify-center gap-0.5 rounded-[0.875rem] border-2 border-dashed text-xs font-bold"
                data-testid="bulk-meal-add"
              >
                <Plus aria-hidden className="size-5.5" />
                Add
              </button>
            </li>
          )
        )}
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
          <p className="text-caption text-on-warning-soft">
            {noTimeWords(count, earlierDay, meal.anchorAt !== null)}
          </p>
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
