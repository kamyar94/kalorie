"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from "lucide-react";
import { useRef, useState } from "react";

import type { MealPhotoDto } from "@/lib/contracts/meals";

const MIN = 1;
const MAX = 5;

type View = { scale: number; x: number; y: number };
const RESET: View = { scale: 1, x: 0, y: 0 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * A full-screen photo with pinch to zoom, drag to pan, double tap (or the buttons, the mouse
 * wheel and the + and - keys) to zoom, and swipe or arrows between photos.
 */
export const PhotoViewer = ({
  photos,
  index,
  onIndexChange,
  onClose,
}: {
  photos: MealPhotoDto[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) => {
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
  } | null>(null);
  const lastTap = useRef(0);
  const open = index !== null;
  const photo = index !== null ? photos[index] : undefined;

  // A new photo starts unzoomed (state adjusted during render).
  const [shownIndex, setShownIndex] = useState(index);
  if (shownIndex !== index) {
    setShownIndex(index);
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
    if (next >= 0 && next < photos.length) onIndexChange(next);
  };

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col text-white outline-none"
          onKeyDown={(event) => {
            if (event.key === "+" || event.key === "=") zoomBy(1.5);
            else if (event.key === "-") zoomBy(1 / 1.5);
            else if (event.key === "ArrowRight" && view.scale === 1) go(1);
            else if (event.key === "ArrowLeft" && view.scale === 1) go(-1);
          }}
        >
          <Dialog.Title className="sr-only">
            Photo {index !== null ? index + 1 : ""} of {photos.length}
          </Dialog.Title>
          <div
            ref={stage}
            className="relative flex-1 touch-none overflow-hidden select-none"
            onWheel={(event) => zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15)}
            onPointerDown={(event) => {
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
              };
            }}
            onPointerMove={(event) => {
              if (!pointers.current.has(event.pointerId) || !gesture.current) return;
              pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
              const g = gesture.current;
              if (pointers.current.size >= 2 && g.dist > 0) {
                g.moved = true;
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
              pointers.current.delete(event.pointerId);
              if (pointers.current.size > 0) {
                // One finger stays down: continue as a pan from here.
                const [rest] = [...pointers.current.values()];
                gesture.current = rest
                  ? {
                      ...g!,
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
              if (view.scale === 1 && Math.abs(dx) > 60) {
                go(dx < 0 ? 1 : -1);
                return;
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
              // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin photo
              <img
                src={photo.urls.original}
                alt={`Photo ${index! + 1} of the meal`}
                draggable={false}
                className="absolute inset-0 size-full object-contain transition-transform duration-75 motion-reduce:transition-none"
                style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
              />
            )}
          </div>

          <div className="absolute inset-x-0 top-0 flex items-center justify-between px-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
            <Dialog.Close
              aria-label="Close the photo"
              className="grid size-12 place-items-center rounded-full bg-black/55"
            >
              <X aria-hidden className="size-6" />
            </Dialog.Close>
            <p className="text-label tabular rounded-full bg-black/55 px-3 py-1.5">
              {index !== null ? index + 1 : 0} / {photos.length}
            </p>
            <span aria-hidden className="size-12" />
          </div>

          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <button
              type="button"
              aria-label="Previous photo"
              disabled={!index}
              onClick={() => go(-1)}
              className="grid size-12 place-items-center rounded-full bg-black/55 disabled:opacity-30"
            >
              <ChevronLeft aria-hidden className="size-6" />
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              disabled={view.scale <= MIN}
              onClick={() => zoomBy(1 / 1.5)}
              className="grid size-12 place-items-center rounded-full bg-black/55 disabled:opacity-30"
            >
              <ZoomOut aria-hidden className="size-6" />
            </button>
            <button
              type="button"
              aria-label="Zoom in"
              disabled={view.scale >= MAX}
              onClick={() => zoomBy(1.5)}
              className="grid size-12 place-items-center rounded-full bg-black/55 disabled:opacity-30"
            >
              <ZoomIn aria-hidden className="size-6" />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              disabled={index === null || index >= photos.length - 1}
              onClick={() => go(1)}
              className="grid size-12 place-items-center rounded-full bg-black/55 disabled:opacity-30"
            >
              <ChevronRight aria-hidden className="size-6" />
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
