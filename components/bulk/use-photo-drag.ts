"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { PressView } from "@/components/ui/use-hold-press";
import { endHold, HOLD, startHold, stepHold, type Hold } from "@/lib/ui/hold";

/**
 * Holding and dragging photos on "Add photos" (boards 46 and 50), with pointer events only:
 * - touch and hold (press and hold with the mouse) HOLD.ms without moving: the ring fills and the
 *   photo is held; letting go then makes it the meal's cover (onHold), moving drags it;
 * - a finger that moves before that is scrolling (the hold is off); a mouse that moves
 *   DRAG.mouseSlop px with the button down drags at once;
 * - a short press is a click (the screen opens the photo larger).
 * While a photo is held or lifted the page does not scroll under the finger; holding near the top
 * or bottom of the list scrolls it, Escape puts the photos back. Drop targets carry `data-drop`
 * (a meal's id, or "new"); the click that ends a hold or a drag is ignored (ignoreClick).
 */
export const DRAG = {
  holdMs: HOLD.ms,
  touchSlop: HOLD.touchSlop,
  mouseSlop: HOLD.mouseSlop,
  /** Holding this close (px) to the top or bottom of the list scrolls it... */
  edge: 72,
  /** ...by up to this many px a frame. */
  scrollStep: 16,
  /** A click this soon (ms) after a hold or a drop belongs to it. */
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
  additive: boolean;
  hold: Hold;
  startedAt: number;
  /** Whether this press can become a hold (Shift or Ctrl with a mouse is for selecting). */
  holds: boolean;
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
  /** Held and let go without moving: make it the cover. */
  onHold: (photoId: string) => void;
  onLift?: (ids: string[]) => void;
  onDrop: (ids: string[], target: string) => void;
  /** Let go away from a target, Escape, or a cancelled pointer. */
  onCancel?: (ids: string[]) => void;
}) => {
  const [view, setView] = useState<DragView | null>(null);
  const [press, setPress] = useState<PressView | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const quietUntil = useRef(0);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  // A held or lifted photo holds the page still: the finger moves the photo, not the list. (A
  // listener that is not passive, so the browser waits for it before it scrolls.)
  useEffect(() => {
    const hold = (event: TouchEvent) => {
      const g = gesture.current;
      if (g && (g.ids || g.hold.phase === "held") && event.cancelable) event.preventDefault();
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
    const touch = event.pointerType !== "mouse";
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const g: Gesture = {
      pointerId: event.pointerId,
      photoId,
      additive,
      hold: startHold(event.clientX, event.clientY, touch),
      startedAt: performance.now(),
      holds: touch || !additive,
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

    const arm = () => {
      g.timer = null;
      g.hold = stepHold(g.hold, {
        type: "time",
        elapsed: Math.max(HOLD.ms, performance.now() - g.startedAt),
      });
      if (g.hold.phase !== "held") return;
      navigator.vibrate?.(HOLD.vibrateMs);
      setPress({ id: g.photoId, startedAt: g.startedAt, held: true });
    };

    const lift = () => {
      if (g.timer !== null) window.clearTimeout(g.timer);
      g.timer = null;
      setPress(null);
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
      if (g.ids) {
        g.over = targetAt(g.x, g.y);
        show();
        return;
      }
      g.hold = stepHold(g.hold, { type: "move", x: g.x, y: g.y });
      if (g.hold.phase !== "moved") return;
      // A finger that moves before the hold is scrolling; after it, and with a mouse, it drags.
      if (g.hold.touch && !g.hold.heldBeforeMove) finish();
      else lift();
    };

    const up = (e: PointerEvent) => {
      if (e.pointerId !== g.pointerId) return;
      const ids = g.ids;
      const outcome = endHold(g.hold);
      finish();
      if (ids) {
        quietClick();
        const target = targetAt(e.clientX, e.clientY);
        if (target) latest.current.onDrop(ids, target);
        else latest.current.onCancel?.(ids);
      } else if (outcome === "hold") {
        quietClick();
        latest.current.onHold(g.photoId);
      }
    };

    const cancel = (e: PointerEvent) => {
      if (e.pointerId !== g.pointerId) return;
      const ids = g.ids;
      finish();
      if (ids) latest.current.onCancel?.(ids);
    };

    // Capture on window: runs before the dialog's own Escape (which would close the screen).
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (!g.ids && g.hold.phase !== "held")) return;
      e.preventDefault();
      e.stopPropagation();
      const ids = g.ids;
      quietClick();
      finish();
      if (ids) latest.current.onCancel?.(ids);
    };

    const finish = () => {
      if (g.timer !== null) window.clearTimeout(g.timer);
      g.timer = null;
      cancelAnimationFrame(g.frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      if (gesture.current === g) gesture.current = null;
      const wasLifted = g.ids !== null;
      g.ids = null;
      if (wasLifted) setView(null);
      setPress(null);
    };

    g.stop = finish;
    gesture.current = g;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    if (g.holds) {
      g.timer = window.setTimeout(arm, HOLD.ms);
      setPress({ id: photoId, startedAt: g.startedAt, held: false });
    }
  }, []);

  /**
   * Whether a click belongs to a hold or a drop that just ended (and should not open the photo):
   * the first click within DRAG.quietClickMs does, later ones are the person's own.
   */
  const ignoreClick = useCallback(() => {
    if (performance.now() >= quietUntil.current) return false;
    quietUntil.current = 0;
    return true;
  }, []);

  return { view, press, onPointerDown, ignoreClick };
};
