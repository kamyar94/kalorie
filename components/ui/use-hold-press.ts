"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { HOLD, startHold, stepHold, type Hold } from "@/lib/ui/hold";

/** A click this soon (ms) after a hold belongs to the hold (it does not also open the photo). */
const QUIET_CLICK_MS = 400;

/** The press shown on a photo: its ring, full once held. */
export type PressView = { id: string; startedAt: number; held: boolean };

/**
 * Touch and hold (press and hold with the mouse) on photos (lib/ui/hold.ts): holding one for
 * HOLD.ms without moving calls onHold at once, with a short buzz where the device has one;
 * moving or letting go earlier cancels, and a short press stays a click. Pointer events only, one
 * press at a time; a finger that moves is scrolling the page, which the hold leaves alone.
 */
export const useHoldPress = ({
  canHold,
  onHold,
}: {
  /** Whether this photo can be held (not the cover already, not while changes are locked). */
  canHold: (id: string) => boolean;
  onHold: (id: string) => void;
}) => {
  const [press, setPress] = useState<PressView | null>(null);
  const active = useRef<(() => void) | null>(null);
  const quietUntil = useRef(0);
  const latest = useRef({ canHold, onHold });
  useEffect(() => {
    latest.current = { canHold, onHold };
  });
  useEffect(() => () => active.current?.(), []);

  const onPointerDown = useCallback((id: string, event: React.PointerEvent) => {
    if (active.current || !latest.current.canHold(id)) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const pointerId = event.pointerId;
    const startedAt = performance.now();
    let hold: Hold = startHold(event.clientX, event.clientY, event.pointerType !== "mouse");

    const timer = window.setTimeout(() => {
      hold = stepHold(hold, {
        type: "time",
        elapsed: Math.max(HOLD.ms, performance.now() - startedAt),
      });
      if (hold.phase !== "held") return;
      navigator.vibrate?.(HOLD.vibrateMs);
      setPress({ id, startedAt, held: true });
      latest.current.onHold(id);
    }, HOLD.ms);

    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      hold = stepHold(hold, { type: "move", x: e.clientX, y: e.clientY });
      if (hold.phase === "moved") finish();
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId === pointerId) finish();
    };
    const finish = () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (hold.phase === "held" || hold.heldBeforeMove)
        quietUntil.current = performance.now() + QUIET_CLICK_MS;
      active.current = null;
      setPress(null);
    };

    active.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    setPress({ id, startedAt, held: false });
  }, []);

  /**
   * Whether a click belongs to a hold that just ended (and should not open the photo): the first
   * click within QUIET_CLICK_MS does, later ones are the person's own.
   */
  const ignoreClick = useCallback(() => {
    if (performance.now() >= quietUntil.current) return false;
    quietUntil.current = 0;
    return true;
  }, []);

  return { press, onPointerDown, ignoreClick };
};
