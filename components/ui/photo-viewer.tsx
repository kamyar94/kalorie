"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";

import { cn } from "./cn";

const MIN = 1;
const MAX = 5;
/** A swipe sideways this long (px) goes to the next or previous photo... */
const SWIPE = 60;
/** ...and down this long closes the viewer. */
const SWIPE_DOWN = 90;

type View = { scale: number; x: number; y: number };
const RESET: View = { scale: 1, x: 0, y: 0 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A photo in the viewer: `src` is the large copy, `alt` says which photo it is. */
export type ViewerPhoto = { id: string; src: string; alt: string };

/** A line under the photo after an action ("Cover changed"), with Undo when it can go back. */
export type ViewerStatus = { text: string; onUndo?: () => void } | null;

/**
 * A photo larger, full screen (board 49): "Photo n of k" and a line about the meal, the photo as
 * large as the screen allows, previous and next (the arrows, a swipe, the arrow keys), pinch, a
 * double tap or the mouse wheel (and the + and - keys) to zoom, and drag to look around a zoomed
 * photo. Closes with ✕, Escape or a swipe down; focus stays inside and goes back where it was.
 * The screen that opens it gives the buttons under the photo (on the meal page "Make it the cover"
 * and "Remove photo", on "Add photos" "Make it the cover" and "Select").
 */
export const PhotoViewer = ({
  photos,
  index,
  onIndexChange,
  onClose,
  subtitle,
  actions,
  status = null,
  onCloseAutoFocus,
}: {
  photos: ViewerPhoto[];
  /** The photo shown; null when the viewer is closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** "Lunch · taken 12:48". */
  subtitle?: string;
  actions?: ReactNode;
  status?: ViewerStatus;
  onCloseAutoFocus?: (event: Event) => void;
}) => {
  const hintId = useId();
  const [view, setView] = useState<View>(RESET);
  const stage = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    dist: number;
    scale: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    moved: boolean;
    pinched: boolean;
  } | null>(null);
  const lastTap = useRef(0);
  const prevButton = useRef<HTMLButtonElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const open = index !== null && index < photos.length;
  const photo = open ? photos[index] : undefined;

  // Another photo starts unzoomed (state adjusted during render).
  const [shownId, setShownId] = useState(photo?.id ?? null);
  if (shownId !== (photo?.id ?? null)) {
    setShownId(photo?.id ?? null);
    setView(RESET);
  }

  const bounded = (next: View): View => {
    const rect = stage.current?.getBoundingClientRect();
    const scale = clamp(next.scale, MIN, MAX);
    if (!rect || scale === 1) return { scale, x: 0, y: 0 };
    const maxX = (rect.width * (scale - 1)) / 2;
    const maxY = (rect.height * (scale - 1)) / 2;
    return { scale, x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY) };
  };

  const zoomBy = (factor: number) => setView((v) => bounded({ ...v, scale: v.scale * factor }));

  const go = (delta: number) => {
    if (index === null) return;
    const next = index + delta;
    if (next < 0 || next >= photos.length) return;
    onIndexChange(next);
    // The arrow just used turns off at the first or last photo: the focus moves to the other one
    // (it would fall out of the viewer otherwise).
    const used = delta > 0 ? nextButton.current : prevButton.current;
    const other = delta > 0 ? prevButton : nextButton;
    if (document.activeElement === used && (next === 0 || next === photos.length - 1))
      requestAnimationFrame(() => other.current?.focus());
  };

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const count = photos.length;
  const number = (index ?? 0) + 1;
  const arrow =
    "absolute top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white disabled:opacity-30";

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[55] bg-black" />
        <Dialog.Content
          aria-describedby={hintId}
          onCloseAutoFocus={onCloseAutoFocus}
          className="fixed inset-0 z-[55] flex flex-col gap-3 bg-black px-4 pt-[max(env(safe-area-inset-top),0.875rem)] pb-[max(env(safe-area-inset-bottom),1rem)] text-white outline-none"
          data-testid="photo-viewer"
          onKeyDown={(event) => {
            if (event.key === "+" || event.key === "=") zoomBy(1.5);
            else if (event.key === "-") zoomBy(1 / 1.5);
            else if (event.key === "ArrowRight" && view.scale === 1) go(1);
            else if (event.key === "ArrowLeft" && view.scale === 1) go(-1);
          }}
        >
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2.5">
            <Dialog.Close
              aria-label="Close"
              className="grid size-11 shrink-0 place-items-center rounded-full bg-white/15 hover:bg-white/25"
            >
              <X aria-hidden className="size-5" />
            </Dialog.Close>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[0.9375rem] leading-snug font-bold">
                Photo {number} of {count}
              </Dialog.Title>
              {subtitle && (
                <p className="text-caption truncate text-white/75" dir="auto">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          <div
            ref={stage}
            className="relative mx-auto min-h-0 w-full max-w-3xl flex-1 touch-none overflow-hidden rounded-[1.125rem] select-none"
            onWheel={(event) => zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15)}
            onPointerDown={(event) => {
              // The arrows are buttons of their own: their taps are not swipes or double taps.
              if ((event.target as HTMLElement).closest("button")) return;
              (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
              pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
              gesture.current = {
                dist: distance(),
                scale: view.scale,
                x: view.x,
                y: view.y,
                startX: event.clientX,
                startY: event.clientY,
                moved: false,
                pinched: pointers.current.size >= 2,
              };
            }}
            onPointerMove={(event) => {
              if (!pointers.current.has(event.pointerId) || !gesture.current) return;
              pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
              const g = gesture.current;
              if (pointers.current.size >= 2 && g.dist > 0) {
                g.moved = true;
                g.pinched = true;
                setView(bounded({ scale: (g.scale * distance()) / g.dist, x: g.x, y: g.y }));
              } else if (pointers.current.size === 1) {
                const dx = event.clientX - g.startX;
                const dy = event.clientY - g.startY;
                if (Math.abs(dx) + Math.abs(dy) > 6) g.moved = true;
                if (view.scale > 1)
                  setView(bounded({ scale: view.scale, x: g.x + dx, y: g.y + dy }));
              }
            }}
            onPointerUp={(event) => {
              const g = gesture.current;
              if (!pointers.current.has(event.pointerId)) return;
              pointers.current.delete(event.pointerId);
              if (pointers.current.size > 0) {
                // One finger stays down: go on as a pan from here.
                const [rest] = [...pointers.current.values()];
                gesture.current =
                  rest && g
                    ? {
                        ...g,
                        dist: 0,
                        scale: view.scale,
                        x: view.x,
                        y: view.y,
                        startX: rest.x,
                        startY: rest.y,
                      }
                    : null;
                return;
              }
              gesture.current = null;
              if (!g) return;
              const dx = event.clientX - g.startX;
              const dy = event.clientY - g.startY;
              if (view.scale === 1 && !g.pinched) {
                if (dy > SWIPE_DOWN && dy > Math.abs(dx)) return onClose();
                if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy)) return go(dx < 0 ? 1 : -1);
              }
              if (!g.moved) {
                const now = Date.now();
                if (now - lastTap.current < 300) {
                  lastTap.current = 0;
                  setView(view.scale > 1 ? RESET : bounded({ scale: 2.5, x: 0, y: 0 }));
                } else lastTap.current = now;
              }
            }}
            onPointerCancel={(event) => {
              pointers.current.delete(event.pointerId);
              gesture.current = null;
            }}
          >
            {photo && (
              // eslint-disable-next-line @next/next/no-img-element -- a same-origin or local photo
              <img
                src={photo.src}
                alt={photo.alt}
                draggable={false}
                className="absolute inset-0 size-full object-contain transition-transform duration-75 motion-reduce:transition-none"
                style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
              />
            )}
            {count > 1 && (
              <>
                <button
                  ref={prevButton}
                  type="button"
                  aria-label="Previous photo"
                  disabled={!index}
                  onClick={() => go(-1)}
                  className={cn(arrow, "left-2")}
                >
                  <ChevronLeft aria-hidden className="size-6" />
                </button>
                <button
                  ref={nextButton}
                  type="button"
                  aria-label="Next photo"
                  disabled={index === null || index >= count - 1}
                  onClick={() => go(1)}
                  className={cn(arrow, "right-2")}
                >
                  <ChevronRight aria-hidden className="size-6" />
                </button>
              </>
            )}
          </div>

          {count > 1 && (
            <div aria-hidden className="flex justify-center gap-1.5">
              {photos.map((p, i) => (
                <span
                  key={p.id}
                  className={cn("size-2 rounded-full", i === index ? "bg-white" : "bg-white/35")}
                />
              ))}
            </div>
          )}

          <div aria-live="polite" className="mx-auto w-full max-w-md empty:hidden">
            {status && (
              <div
                className="text-caption flex items-center gap-2 rounded-2xl bg-white py-1 pr-1 pl-3.5 font-semibold text-black"
                data-testid="photo-viewer-status"
              >
                <span className="min-w-0 flex-1 py-2">{status.text}</span>
                {status.onUndo && (
                  <button
                    type="button"
                    onClick={status.onUndo}
                    className="min-h-11 shrink-0 rounded-xl px-3 underline underline-offset-2"
                  >
                    Undo
                  </button>
                )}
              </div>
            )}
          </div>

          {actions && <div className="mx-auto flex w-full max-w-md gap-2">{actions}</div>}

          <p id={hintId} className="text-caption text-center text-white/75">
            {count > 1 ? "Swipe or use the arrows for the other photos; pinch" : "Pinch"} or
            double-tap to zoom.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

/** The classes of a button under the viewer's photo: the main one or another. */
export const viewerButton = (main: boolean) =>
  cn(
    "inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-bold disabled:opacity-50",
    main
      ? "bg-primary text-on-primary hover:bg-primary-hover"
      : "bg-white/15 text-white hover:bg-white/25",
  );
