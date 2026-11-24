"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  Check,
  Circle,
  CircleAlert,
  Clock,
  FolderInput,
  Hourglass,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";

import { WhenSheet } from "@/components/capture/when-sheet";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { groupPhotos, limitBatch, type SortPhoto } from "@/lib/bulk/group";
import {
  bulkReducer,
  checkMove,
  earliestTaken,
  initBulk,
  mealHasNoTime,
  shownPhotoIds,
  type BulkAction,
  type BulkMeal,
  type BulkState,
  type MoveTarget,
} from "@/lib/bulk/moves";
import { mapLimit } from "@/lib/bulk/pool";
import { BULK } from "@/lib/bulk/rules";
import { dayHeading, slotAt, timeProblem } from "@/lib/bulk/times";
import type { QueuedMeal } from "@/lib/client/capture-queue";
import { MEAL_SLOT_LABELS } from "@/lib/contracts/meals";
import { localParts, type MealWindows } from "@/lib/meals/time";
import { prepareBatchPhoto, readCaptureTime } from "@/lib/photos/client";
import { whenSpoken } from "@/lib/ui/when";

import { BulkMealCard, noTimeWords, photoCount, type BulkAsset } from "./bulk-meal-card";
import { MoveSheet } from "./move-sheet";
import { usePhotoDrag } from "./use-photo-drag";

/** What opens "Add photos": the picked files, and photos the camera had already. */
export type BulkRequest = {
  key: number;
  files: Blob[];
  /** Photos the camera took or prepared already; they keep their time. */
  shots: { blob: Blob; capturedAt: Date }[];
  openedAt: Date;
  /** The time of a meal with no time taken (see lib/bulk/times.ts fallbackTime). */
  fallbackAt: Date;
  /** Opened from Today on an earlier day: a meal with no time starts at 12:00 of it. */
  earlierDay: boolean;
};

/** One meal for the upload queue. */
export type BulkMealToAdd = {
  photos: { blob: Blob; width: number; height: number }[];
  eatenAt: Date;
  note: string;
};

type Photo = BulkAsset & { blob: Blob; width: number; height: number; takenAt: number | null };
type Phase = "reading" | "sorting" | "adding" | "empty";

const mealCount = (n: number) => `${n} ${n === 1 ? "meal" : "meals"}`;

/** A ref whose element is looked up when it is used (the element may have moved by then). */
const lazyRef = (find: () => HTMLElement | null) =>
  ({
    get current() {
      return find();
    },
  }) as RefObject<HTMLElement | null>;

const focusLater = (selector: string) =>
  requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());

const barButton =
  "text-label bg-bg hover:bg-surface-3 inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full px-3 sm:flex-none";

type ScreenProps = {
  request: BulkRequest | null;
  tz: string;
  mealWindows: MealWindows | null;
  queue: QueuedMeal[];
  uploading: ReadonlySet<string>;
  online: boolean;
  /** Puts the meals in the upload queue, oldest first; resolves to their client ids. */
  onAdd: (meals: BulkMealToAdd[]) => Promise<string[]>;
  onClose: () => void;
  /** Every meal was sent: the screen closes. */
  onDone: (count: number) => void;
};

/**
 * "Add photos" (boards 44 to 47): a full-screen layer, like the camera, over the page. It reads
 * the photos on the device (time taken, a small preview and how they look), groups them into
 * meals (lib/bulk/group.ts), lets the person check each meal (time, note), select photos and move
 * them by dragging or with "Move to…", then sends each meal through the device's upload queue
 * like any photo meal. Nothing leaves the device before "Add".
 */
export const BulkScreen = (props: ScreenProps) =>
  props.request ? <BulkSession key={props.request.key} {...props} request={props.request} /> : null;

const BulkSession = ({
  request,
  tz,
  mealWindows,
  queue,
  uploading,
  online,
  onAdd,
  onClose,
  onDone,
}: ScreenProps & { request: BulkRequest }) => {
  const introId = useId();
  const readingId = useId();
  const addingId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const urls = useRef<string[]>([]);
  const noticeTimer = useRef<number | null>(null);
  const afterSheet = useRef<string | null>(null);
  const [phase, setPhase] = useState<Phase>("reading");
  const [progress, setProgress] = useState({
    done: 0,
    total: Math.min(BULK.maxPhotos, request.files.length + request.shots.length),
  });
  const [photos, setPhotos] = useState<Record<string, Photo>>({});
  const [bulk, setBulk] = useState<BulkState | null>(null);
  const [skipped, setSkipped] = useState({ picked: 0, over: 0, failed: 0 });
  const [now, setNow] = useState(request.openedAt);
  const [sent, setSent] = useState<{ clientId: string; label: string }[]>([]);
  const [adding, setAdding] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [whenFor, setWhenFor] = useState<string | null>(null);
  /** The meal whose time was changed last: its chip gets the focus back. */
  const [whenLast, setWhenLast] = useState<string | null>(null);
  const [moreFor, setMoreFor] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // Read the photos: the time taken of each (to keep the first 30), then the photo itself, a few
  // at a time, then the meals Kal finds.
  useEffect(() => {
    let cancelled = false;
    const made = urls.current;
    const run = async () => {
      const times = await mapLimit(request.files, 4, (file) => readCaptureTime(file));
      if (cancelled) return;
      const entries = [
        ...request.shots.map((shot) => ({
          file: shot.blob,
          takenAt: shot.capturedAt.getTime() as number | null,
          prepared: true,
        })),
        ...request.files.map((file, i) => {
          const time = times[i];
          return {
            file,
            takenAt: time?.status === "fulfilled" && time.value ? time.value.getTime() : null,
            prepared: false,
          };
        }),
      ].map((entry, i) => ({ ...entry, id: `p${i + 1}` }));
      const { kept, left } = limitBatch(entries, BULK.maxPhotos);
      const keep = new Set(kept);
      const chosen = entries.filter((entry) => keep.has(entry.id));
      setProgress({ done: 0, total: chosen.length });
      const results = await mapLimit(
        chosen,
        BULK.concurrency,
        (entry) =>
          prepareBatchPhoto(entry.file, {
            capturedAt: entry.takenAt === null ? null : new Date(entry.takenAt),
            alreadyPrepared: entry.prepared,
          }),
        (done) => {
          if (!cancelled) setProgress({ done, total: chosen.length });
        },
      );
      if (cancelled) return;
      const ready: Record<string, Photo> = {};
      const sorted: SortPhoto[] = [];
      results.forEach((result, i) => {
        const entry = chosen[i]!;
        if (result.status !== "fulfilled") return;
        const url = URL.createObjectURL(result.value.preview);
        made.push(url);
        ready[entry.id] = {
          id: entry.id,
          url,
          time: entry.takenAt === null ? null : localParts(new Date(entry.takenAt), tz).time,
          blob: result.value.blob,
          width: result.value.width,
          height: result.value.height,
          takenAt: entry.takenAt,
        };
        sorted.push({ id: entry.id, takenAt: entry.takenAt, signature: result.value.signature });
      });
      setSkipped({
        picked: entries.length,
        over: left,
        failed: chosen.length - sorted.length,
      });
      setPhotos(ready);
      if (!sorted.length) return setPhase("empty");
      setBulk(initBulk(sorted, groupPhotos(sorted, tz), request.fallbackAt.getTime()));
      setPhase("sorting");
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [request, tz]);

  useEffect(() => {
    const made = urls.current;
    return () => {
      for (const url of made) URL.revokeObjectURL(url);
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  const apply = (action: BulkAction) => {
    if (!bulk) return null;
    const next = bulkReducer(bulk, action);
    setBulk(next);
    return next;
  };

  const notify = (text: string | null) => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = null;
    setNotice(text);
    if (text) noticeTimer.current = window.setTimeout(() => setNotice(null), 8000);
  };

  const timeOf = (at: number) => localParts(new Date(at), tz).time;
  const slotOf = (meal: BulkMeal) =>
    MEAL_SLOT_LABELS[slotAt(new Date(meal.at), tz, mealWindows, meal.note)];
  const labelOf = (meal: BulkMeal) => `${timeOf(meal.at)} · ${slotOf(meal)}`;

  /** Moves photos to a meal or a new one, or says why not. */
  const move = (ids: string[], to: MoveTarget) => {
    if (!bulk) return false;
    const check = checkMove(bulk, ids, to);
    if (!check.ok) {
      if (check.reason === "full")
        notify(
          `Meal ${check.number} already has ${BULK.perMeal} photos. Drop on another meal or on New meal.`,
        );
      else if (check.reason === "too-many")
        notify(
          `A meal holds up to ${BULK.perMeal} photos. Move ${BULK.perMeal} or fewer at a time.`,
        );
      else setAnnouncement("Not moved: the photos are in that meal already.");
      return false;
    }
    const next = bulkReducer(bulk, { type: "move", ids, to });
    setBulk(next);
    notify(null);
    const number = next.meals.findIndex((meal) => meal.photoIds.includes(check.ids[0]!)) + 1;
    setAnnouncement(
      `${photoCount(check.ids.length)} moved to ${to === "new" ? "a new meal, " : ""}meal ${number}.`,
    );
    afterSheet.current = `[data-photo-id="${check.ids[0]}"]`;
    return true;
  };

  const drag = usePhotoDrag({
    scroller,
    liftIds: (photoId, additive) => {
      if (!bulk) return [];
      const order = shownPhotoIds(bulk);
      let selected = bulk.selected;
      if (!selected.includes(photoId)) {
        if (!additive) return [photoId];
        selected = apply({ type: "select", id: photoId })?.selected ?? [photoId];
      }
      return order.filter((id) => selected.includes(id));
    },
    onLift: (ids) =>
      setAnnouncement(
        `${photoCount(ids.length)} lifted. Move over a meal and let go, or press Escape.`,
      ),
    onDrop: (ids, target) => {
      if (move(ids, target)) {
        const selector = afterSheet.current;
        afterSheet.current = null;
        if (selector) focusLater(selector);
      }
    },
    onCancel: () => setAnnouncement("Not moved."),
  });

  const whenReturn = useMemo(
    () => lazyRef(() => document.querySelector(`[data-time-chip="${whenLast}"]`)),
    [whenLast],
  );

  const requestClose = () => {
    if (phase === "sorting" && bulk?.meals.length) setConfirmClose(true);
    else onClose();
  };

  const add = async () => {
    if (!bulk || adding || !bulk.meals.length) return;
    const current = new Date();
    setNow(current);
    if (bulk.meals.some((meal) => timeProblem(new Date(meal.at), current, tz))) return;
    setAdding(true);
    try {
      const meals = bulk.meals.map((meal) => ({
        photos: meal.photoIds.map((id) => ({
          blob: photos[id]!.blob,
          width: photos[id]!.width,
          height: photos[id]!.height,
        })),
        eatenAt: new Date(meal.at),
        note: meal.note.trim(),
      }));
      const labels = bulk.meals.map((meal) => `${slotOf(meal)} ${timeOf(meal.at)}`);
      const ids = await onAdd(meals);
      setSent(ids.map((clientId, i) => ({ clientId, label: labels[i]! })));
      setPhase("adding");
      notify(null);
    } catch {
      notify("The meals could not be saved on this device. Try again.");
    } finally {
      setAdding(false);
    }
  };

  // Every meal sent: back to the page (Today or the meals' day shows them "Analysing").
  const allSent =
    phase === "adding" &&
    sent.length > 0 &&
    sent.every((item) => !queue.some((meal) => meal.clientId === item.clientId));
  useEffect(() => {
    if (!allSent) return;
    const timer = window.setTimeout(() => onDone(sent.length), 900);
    return () => window.clearTimeout(timer);
  }, [allSent, onDone, sent.length]);

  const today = localParts(now, tz).date;
  const meals = bulk?.meals ?? [];
  const count = bulk ? shownPhotoIds(bulk).length : progress.total;
  const selected = new Set(bulk?.selected ?? []);
  const view = drag.view;
  const lifted = new Set(view?.ids ?? []);
  const problems = meals.map((meal) => timeProblem(new Date(meal.at), now, tz));
  const firstProblem = problems.findIndex(Boolean);

  const sections: { date: string; meals: { meal: BulkMeal; number: number }[] }[] = [];
  meals.forEach((meal, i) => {
    const date = localParts(new Date(meal.at), tz).date;
    const section = sections.at(-1);
    if (section?.date === date) section.meals.push({ meal, number: i + 1 });
    else sections.push({ date, meals: [{ meal, number: i + 1 }] });
  });

  const dropFor = (mealId: string) => {
    if (!view || !bulk || view.over !== mealId) return null;
    const check = checkMove(bulk, view.ids, mealId);
    if (check.ok) return { kind: "ok" as const, count: check.ids.length };
    return check.reason === "full" ? { kind: "full" as const } : null;
  };
  const newCheck = view && bulk && view.over === "new" ? checkMove(bulk, view.ids, "new") : null;

  const whenMeal = meals.find((meal) => meal.id === whenFor) ?? null;
  const whenNumber = whenMeal ? meals.indexOf(whenMeal) + 1 : 0;
  const whenTaken = whenMeal && bulk ? earliestTaken(bulk.photos, whenMeal.photoIds) : null;
  const moreMeal = meals.find((meal) => meal.id === moreFor) ?? null;
  const moreNumber = moreMeal ? meals.indexOf(moreMeal) + 1 : 0;

  const openWhen = (mealId: string) => {
    setWhenLast(mealId);
    setWhenFor(mealId);
  };

  const statusOf = (clientId: string) => {
    const queued = queue.find((meal) => meal.clientId === clientId);
    if (!queued) return { key: "sent", text: "sent" };
    if (uploading.has(clientId)) return { key: "sending", text: "sending" };
    if (queued.state === "failed") return { key: "failed", text: "not sent" };
    return { key: "waiting", text: online ? "waiting" : "waiting for a connection" };
  };

  return (
    <Dialog.Root open onOpenChange={(next) => !next && requestClose()}>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={phase === "sorting" ? introId : undefined}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            requestClose();
          }}
          className={cn(
            "bg-bg text-text data-[state=open]:animate-fade-in fixed inset-0 z-50 flex flex-col outline-none",
            view && "select-none",
          )}
          data-testid="bulk"
          data-phase={phase}
        >
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-2.5 px-4 pt-[max(env(safe-area-inset-top),0.875rem)] pb-2">
            <div className="flex items-center gap-2">
              <Dialog.Close
                aria-label="Close"
                className="bg-surface-2 hover:bg-surface-3 grid size-11 shrink-0 place-items-center rounded-full"
              >
                <X aria-hidden className="size-5" />
              </Dialog.Close>
              <div className="min-w-0 flex-1">
                <Dialog.Title asChild>
                  <h1 className="text-[1.25rem] leading-tight font-bold">
                    Add {photoCount(count)}
                  </h1>
                </Dialog.Title>
                {phase === "sorting" && (
                  <p className="text-caption text-muted" data-testid="bulk-found">
                    {mealCount(meals.length)}
                    {bulk?.changed ? "" : " found"}
                  </p>
                )}
              </div>
            </div>

            {phase === "sorting" && bulk && bulk.selected.length > 0 && (
              <div
                role="group"
                aria-label={`${photoCount(bulk.selected.length)} selected`}
                className="border-border bg-surface-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-[1.5rem] border p-1.5 pl-4"
                data-testid="bulk-selection"
              >
                <span className="text-label min-w-0 flex-1">{bulk.selected.length} selected</span>
                <button
                  type="button"
                  aria-label="Clear the selection"
                  onClick={() => apply({ type: "clear" })}
                  className="bg-bg hover:bg-surface-3 grid size-11 shrink-0 place-items-center rounded-full sm:order-last"
                >
                  <X aria-hidden className="size-4.5" />
                </button>
                <div className="flex w-full gap-2 sm:w-auto">
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    onClick={() => setMoveOpen(true)}
                    className={barButton}
                  >
                    <FolderInput aria-hidden className="size-4" /> Move to…
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (move(bulk.selected, "new")) {
                        const selector = afterSheet.current;
                        afterSheet.current = null;
                        if (selector) focusLater(selector);
                      }
                    }}
                    className={barButton}
                  >
                    <Plus aria-hidden className="size-4" /> New meal
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const n = bulk.selected.length;
                      const next = apply({ type: "remove", ids: bulk.selected });
                      setAnnouncement(
                        `${photoCount(n)} removed. ${mealCount(next?.meals.length ?? 0)} left.`,
                      );
                      focusLater('[data-testid="bulk-add"]');
                    }}
                    className={barButton}
                  >
                    <Trash2 aria-hidden className="size-4" /> Remove
                  </button>
                </div>
              </div>
            )}

            {notice && (
              <div
                role="alert"
                className="bg-warning-soft text-on-warning-soft text-caption rounded-2xl px-3 py-2.5"
                data-testid="bulk-notice"
              >
                {notice}
              </div>
            )}
          </div>

          <div
            ref={scroller}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            data-testid="bulk-list"
          >
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-3.5 px-4 pt-1 pb-6">
              {phase === "reading" && (
                <section
                  aria-labelledby={readingId}
                  className="border-border bg-surface flex flex-col gap-2.5 rounded-[var(--radius-card)] border p-4"
                >
                  <h2 id={readingId} className="text-headline">
                    Reading {photoCount(progress.total)}…
                  </h2>
                  <div
                    role="progressbar"
                    aria-labelledby={readingId}
                    aria-valuemin={0}
                    aria-valuemax={progress.total}
                    aria-valuenow={progress.done}
                    className="bg-surface-2 h-2 overflow-hidden rounded-full"
                  >
                    <div
                      className="bg-primary h-full transition-[width]"
                      style={{
                        width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <p className="text-caption text-muted">
                    On this device Kal reads when each photo was taken and compares how they look,
                    then groups them. Nothing is sent until you tap Add. Location and camera details
                    are never read or sent.
                  </p>
                </section>
              )}

              {phase === "empty" && (
                <section className="border-border bg-surface flex flex-col items-start gap-3 rounded-[var(--radius-card)] border p-4">
                  <h2 className="text-headline">These photos could not be opened</h2>
                  <p className="text-body text-muted">
                    Try other photos, or take them with the camera.
                  </p>
                  <Button variant="secondary" onClick={onClose}>
                    Close
                  </Button>
                </section>
              )}

              {phase === "sorting" && bulk && (
                <>
                  <p id={introId} className="text-caption text-muted">
                    Grouped by when they were taken and how they look. Tap photos to select them,
                    then drag them to another meal or to <b className="text-text">New meal</b>. Each
                    meal is analysed by your AI after you add it.
                  </p>
                  {skipped.over > 0 && (
                    <p className="bg-info-soft text-on-info-soft text-caption rounded-2xl px-3 py-2.5">
                      You picked {skipped.picked} photos. Kal sorts up to {BULK.maxPhotos} at a
                      time, so the first {BULK.maxPhotos} by time taken are here. Add the others
                      after these.
                    </p>
                  )}
                  {skipped.failed > 0 && (
                    <p className="bg-warning-soft text-on-warning-soft text-caption rounded-2xl px-3 py-2.5">
                      {skipped.failed === 1
                        ? "1 photo could not be opened and was left out."
                        : `${skipped.failed} photos could not be opened and were left out.`}
                    </p>
                  )}
                  {!meals.length && <p className="text-body text-muted">No photos left to add.</p>}
                  {sections.map((section) => (
                    <section
                      key={section.date}
                      aria-label={dayHeading(section.date, today)}
                      className="flex flex-col gap-3"
                    >
                      <h2 className="text-caption text-muted mt-1 font-bold tracking-[0.04em] uppercase">
                        {dayHeading(section.date, today)}
                      </h2>
                      {section.meals.map(({ meal, number }) => (
                        <BulkMealCard
                          key={meal.id}
                          meal={meal}
                          number={number}
                          assets={photos}
                          selected={selected}
                          lifted={lifted}
                          timeLabel={timeOf(meal.at)}
                          slotLabel={slotOf(meal)}
                          noTime={mealHasNoTime(bulk, meal)}
                          earlierDay={request.earlierDay}
                          problem={problems[number - 1] ?? null}
                          drop={dropFor(meal.id)}
                          onPhotoPointerDown={drag.onPointerDown}
                          onPhotoClick={(id, additive) => {
                            if (drag.ignoreClick()) return;
                            apply(additive ? { type: "select", id } : { type: "toggle", id });
                          }}
                          onTime={() => openWhen(meal.id)}
                          onNote={(note) => apply({ type: "note", mealId: meal.id, note })}
                          onMore={() => setMoreFor(meal.id)}
                        />
                      ))}
                    </section>
                  ))}
                  <div
                    data-drop="new"
                    data-testid="bulk-new-meal"
                    className={cn(
                      "text-label flex min-h-19 items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed px-4 py-3 text-center",
                      newCheck?.ok
                        ? "border-primary bg-primary-soft text-on-primary-soft"
                        : newCheck
                          ? "bg-warning-soft text-on-warning-soft border-on-warning-soft"
                          : "border-border text-muted",
                    )}
                  >
                    <Plus aria-hidden className="size-4.5 shrink-0" />
                    {newCheck?.ok
                      ? `Drop to move ${photoCount(newCheck.ids.length)} here`
                      : newCheck
                        ? `A meal holds up to ${BULK.perMeal} photos. Move ${BULK.perMeal} or fewer at a time.`
                        : "New meal: drop photos here"}
                  </div>
                </>
              )}

              {phase === "adding" && (
                <section
                  aria-labelledby={addingId}
                  className="border-border bg-surface flex flex-col gap-3 rounded-[var(--radius-card)] border p-4"
                >
                  <h2 id={addingId} className="text-headline">
                    Adding {mealCount(sent.length)}
                  </h2>
                  <ul className="flex flex-col gap-2" data-testid="bulk-progress">
                    {sent.map((item) => {
                      const status = statusOf(item.clientId);
                      return (
                        <li
                          key={item.clientId}
                          className="text-body flex items-center gap-2.5"
                          data-status={status.key}
                        >
                          {status.key === "sent" ? (
                            <Check aria-hidden className="text-primary size-4.5 shrink-0" />
                          ) : status.key === "sending" ? (
                            <Hourglass aria-hidden className="size-4.5 shrink-0" />
                          ) : status.key === "failed" ? (
                            <CircleAlert aria-hidden className="text-danger size-4.5 shrink-0" />
                          ) : (
                            <Circle aria-hidden className="text-muted size-4.5 shrink-0" />
                          )}
                          <span className="min-w-0 flex-1">{item.label}</span>
                          <span className="text-caption text-muted">{status.text}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-caption text-muted">
                    You can leave this screen: sending goes on, and a meal that cannot be sent waits
                    on Today with Try again, like any photo meal. Each one then shows
                    &ldquo;Analysing&rdquo; on its day.
                  </p>
                </section>
              )}
            </div>
          </div>

          {phase === "sorting" && bulk && (
            <div className="border-border bg-bg border-t">
              <div className="mx-auto flex w-full max-w-2xl flex-col gap-1.5 px-4 pt-2.5 pb-[max(env(safe-area-inset-bottom),0.875rem)]">
                <p className="text-caption text-muted text-center">
                  {firstProblem >= 0
                    ? `Change the time of meal ${firstProblem + 1} first.`
                    : "Meals with a note are analysed with it."}
                </p>
                <Button
                  size="lg"
                  fullWidth
                  loading={adding}
                  disabled={!meals.length || firstProblem >= 0}
                  onClick={() => void add()}
                  data-testid="bulk-add"
                >
                  Add {mealCount(meals.length)}
                </Button>
              </div>
            </div>
          )}

          <p aria-live="polite" className="sr-only" data-testid="bulk-status">
            {announcement}
          </p>

          {view && photos[view.lead] && (
            <div
              aria-hidden
              data-testid="bulk-ghost"
              className="pointer-events-none fixed z-[70] -rotate-4 drop-shadow-xl"
              style={{ left: view.x - 42, top: view.y - 42 }}
            >
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                <img
                  src={photos[view.lead]!.url}
                  alt=""
                  className="outline-primary size-21 rounded-[0.875rem] object-cover outline-3 outline-offset-2"
                />
                {view.ids.length > 1 && (
                  <span className="bg-primary text-on-primary border-bg absolute -top-2.5 -left-2.5 grid h-7 min-w-7 place-items-center rounded-full border-2 px-1.5 text-sm font-black">
                    {view.ids.length}
                  </span>
                )}
              </div>
            </div>
          )}

          {bulk && (
            <MoveSheet
              open={moveOpen}
              onOpenChange={setMoveOpen}
              state={bulk}
              assets={photos}
              mealLabel={(mealId) => {
                const meal = meals.find((m) => m.id === mealId);
                return meal ? labelOf(meal) : "";
              }}
              onMove={(to) => {
                if (move(bulk.selected, to)) setMoveOpen(false);
              }}
              onCloseAutoFocus={(event) => {
                const selector = afterSheet.current;
                afterSheet.current = null;
                if (!selector) return;
                event.preventDefault();
                focusLater(selector);
              }}
            />
          )}

          <WhenSheet
            open={whenMeal !== null}
            onOpenChange={(next) => !next && setWhenFor(null)}
            value={whenMeal ? new Date(whenMeal.at) : null}
            tz={tz}
            elevated
            title={`When did you eat meal ${whenNumber}?`}
            description={
              whenTaken !== null
                ? `From the photo: taken ${whenSpoken(new Date(whenTaken), now, tz)}.`
                : whenMeal
                  ? noTimeWords(whenMeal.photoIds.length, request.earlierDay)
                  : ""
            }
            returnFocus={whenReturn}
            onDone={(at) => {
              if (!whenMeal) return;
              const when = at ?? new Date();
              apply({ type: "time", mealId: whenMeal.id, at: when.getTime() });
              setNow(new Date());
              setWhenFor(null);
              setAnnouncement(`Meal time: ${whenSpoken(when, new Date(), tz)}.`);
            }}
          />

          <BottomSheet
            open={moreMeal !== null}
            onOpenChange={(next) => !next && setMoreFor(null)}
            title={`Meal ${moreNumber}`}
            elevated
            onCloseAutoFocus={(event) => {
              const selector = afterSheet.current;
              afterSheet.current = null;
              if (selector === "") return event.preventDefault();
              if (!selector) return;
              event.preventDefault();
              focusLater(selector);
            }}
          >
            {moreMeal && (
              <div className="flex flex-col gap-2 pb-1">
                <Button
                  variant="secondary"
                  fullWidth
                  onClick={() => {
                    // The When sheet takes the focus.
                    afterSheet.current = "";
                    setMoreFor(null);
                    openWhen(moreMeal.id);
                  }}
                >
                  <Clock aria-hidden className="size-4" /> Change the time
                </Button>
                <Button
                  variant="secondary"
                  fullWidth
                  onClick={() => {
                    setBulk((state) =>
                      state
                        ? moreMeal.photoIds.reduce<BulkState>(
                            (s, id) => bulkReducer(s, { type: "select", id }),
                            state,
                          )
                        : state,
                    );
                    afterSheet.current = `[data-photo-id="${moreMeal.photoIds[0]}"]`;
                    setMoreFor(null);
                  }}
                >
                  <Check aria-hidden className="size-4" /> Select its photos
                </Button>
                <Button
                  variant="danger"
                  fullWidth
                  onClick={() => {
                    const next = apply({ type: "remove-meal", mealId: moreMeal.id });
                    setAnnouncement(
                      `Meal ${moreNumber} removed. ${mealCount(next?.meals.length ?? 0)} left.`,
                    );
                    afterSheet.current = '[data-testid="bulk-add"]';
                    setMoreFor(null);
                  }}
                >
                  <Trash2 aria-hidden className="size-4" /> Remove this meal
                </Button>
              </div>
            )}
          </BottomSheet>

          <BottomSheet
            open={confirmClose}
            onOpenChange={setConfirmClose}
            title="Close without adding the meals?"
            description="The photos stay in your gallery. The meals, notes and times here are not kept."
            elevated
            footer={
              <div className="flex gap-2">
                <Button variant="secondary" fullWidth onClick={() => setConfirmClose(false)}>
                  Keep sorting
                </Button>
                <Button variant="danger" fullWidth onClick={onClose}>
                  Close
                </Button>
              </div>
            }
          >
            <p className="text-body text-muted">
              {mealCount(meals.length)} with {photoCount(count)} are not added.
            </p>
          </BottomSheet>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
