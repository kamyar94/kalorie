"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * Dragging photos between meals on "Add photos" (board 46), with pointer events only:
 * - touch (and pen): touch and hold DRAG.holdMs to lift a photo, so a short tap still selects
 *   and a swipe still scrolls (a finger that moves first is scrolling, and the hold is off);
 * - mouse: the photo lifts once it moves DRAG.mouseSlop px with the button down.
 * While a photo is lifted the page does not scroll under the finger; holding near the top or
 * bottom of the list scrolls it, Escape puts the photos back. Drop targets carry `data-drop`
 * (a meal's id, or "new"); the click that ends a drag does not also toggle the photo.
 */
export const DRAG = {
  holdMs: 350,
  touchSlop: 10,
  mouseSlop: 6,
  /** Holding this close (px) to the top or bottom of the list scrolls it... */
  edge: 72,
  /** ...by up to this many px a frame. */
  scrollStep: 16,
  /** A click this soon (ms) after a drop belongs to the drop. */
  quietClickMs: 400,
} as const;

export type DragView = {
  /** The photos carried, in the order shown. */
  ids: string[];
  /** The photo under the finger. */
  lead: string;
  x: number;
  y: number;
  /** The drop target under the pointer (a meal id or "new"), if any. */
  over: string | null;
};

type Gesture = {
  pointerId: number;
  photoId: string;
  touch: boolean;
  additive: boolean;
  startX: number;
  startY: number;
  x: number;
  y: number;
  timer: number | null;
  ids: string[] | null;
  over: string | null;
  frame: number;
  stop: () => void;
};

const targetAt = (x: number, y: number) =>
  document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]")?.dataset.drop ?? null;

export const usePhotoDrag = (options: {
  /** The list that scrolls while a photo is held near its edges. */
  scroller: RefObject<HTMLElement | null>;
  /** The photos a drag of this photo carries; additive is Shift or Ctrl held. */
  liftIds: (photoId: string, additive: boolean) => string[];
  onLift?: (ids: string[]) => void;
  onDrop: (ids: string[], target: string) => void;
  /** Let go away from a target, Escape, or a cancelled pointer. */
  onCancel?: (ids: string[]) => void;
}) => {
  const [view, setView] = useState<DragView | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const quietUntil = useRef(0);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  // A lifted photo holds the page still: the finger moves the photo, not the list. (A listener
  // that is not passive, so the browser waits for it before it scrolls.)
  useEffect(() => {
    const hold = (event: TouchEvent) => {
      if (gesture.current?.ids && event.cancelable) event.preventDefault();
    };
    window.addEventListener("touchmove", hold, { passive: false });
    return () => {
      window.removeEventListener("touchmove", hold);
      gesture.current?.stop();
    };
  }, []);

  const onPointerDown = useCallback((photoId: string, event: React.PointerEvent) => {
    if (gesture.current) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const g: Gesture = {
      pointerId: event.pointerId,
      photoId,
      touch: event.pointerType !== "mouse",
      additive: event.shiftKey || event.ctrlKey || event.metaKey,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      timer: null,
      ids: null,
      over: null,
      frame: 0,
      stop: () => undefined,
    };

    const show = () =>
      setView(g.ids ? { ids: g.ids, lead: g.photoId, x: g.x, y: g.y, over: g.over } : null);

    const tick = () => {
      if (!g.ids) return;
      const list = latest.current.scroller.current;
      if (list) {
        const box = list.getBoundingClientRect();
        const fromTop = g.y - box.top;
        const fromBottom = box.bottom - g.y;
        const step =
          fromTop < DRAG.edge
            ? -DRAG.scrollStep * (1 - Math.max(0, fromTop) / DRAG.edge)
            : fromBottom < DRAG.edge
              ? DRAG.scrollStep * (1 - Math.max(0, fromBottom) / DRAG.edge)
              : 0;
        if (step) {
          const before = list.scrollTop;
          list.scrollTop += step;
          const over = targetAt(g.x, g.y);
          if (list.scrollTop !== before && over !== g.over) {
            g.over = over;
            show();
          }
        }
      }
      g.frame = requestAnimationFrame(tick);
    };

    const lift = () => {
      g.timer = null;
      const ids = latest.current.liftIds(g.photoId, g.additive);
      if (!ids.length) return finish();
      g.ids = ids;
      g.over = targetAt(g.x, g.y);
      latest.current.onLift?.(ids);
      show();
      g.frame = requestAnimationFrame(tick);
    };

    const quietClick = () => {
      quietUntil.current = performance.now() + DRAG.quietClickMs;
    };

    const move = (e: PointerEvent) => {
      if (e.pointerId !== g.pointerId) return;
      g.x = e.clientX;
      g.y = e.clientY;
      if (!g.ids) {
        const distance = Math.hypot(g.x - g.startX, g.y - g.startY);
        if (g.touch) {
          if (distance > DRAG.touchSlop) finish();
        } else if (distance > DRAG.mouseSlop) lift();
        return;
      }
      g.over = targetAt(g.x, g.y);
      show();
    };

    const up = (e: PointerEvent) => {
      if (e.pointerId !== g.pointerId) return;
      const ids = g.ids;
      finish();
      if (!ids) return;
      quietClick();
      const target = targetAt(e.clientX, e.clientY);
      if (target) latest.current.onDrop(ids, target);
      else latest.current.onCancel?.(ids);
    };

    const cancel = (e: PointerEvent) => {
      if (e.pointerId !== g.pointerId) return;
      const ids = g.ids;
      finish();
      if (ids) latest.current.onCancel?.(ids);
    };

    // Capture on window: runs before the dialog's own Escape (which would close the screen).
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !g.ids) return;
      e.preventDefault();
      e.stopPropagation();
      const ids = g.ids;
      quietClick();
      finish();
      latest.current.onCancel?.(ids);
    };

    const finish = () => {
      if (g.timer !== null) window.clearTimeout(g.timer);
      cancelAnimationFrame(g.frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      if (gesture.current === g) gesture.current = null;
      const wasLifted = g.ids !== null;
      g.ids = null;
      if (wasLifted) setView(null);
    };

    g.stop = finish;
    gesture.current = g;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    if (g.touch) g.timer = window.setTimeout(lift, DRAG.holdMs);
  }, []);

  /** Whether a click belongs to a drop that just ended (and should not toggle the photo). */
  const ignoreClick = useCallback(() => performance.now() < quietUntil.current, []);

  return { view, onPointerDown, ignoreClick };
};
