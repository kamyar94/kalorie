// Touch and hold (press and hold with the mouse) on a photo (docs/DESIGN.md sections 3 and 7):
// holding HOLD.ms without moving makes the photo the cover; a tap opens it larger. On "Add photos"
// the same hold lifts the photo: moving after it drags, letting go without moving makes it the
// cover. Plain functions over pointer readings, so the timing and the cancelling are tested
// without a browser (components/ui/use-hold-press.ts and components/bulk/use-photo-drag.ts use
// them).

export const HOLD = {
  /** How long a press must last, without moving, to count as a hold. */
  ms: 450,
  /** A finger may wander this far (px) and still be holding still... */
  touchSlop: 10,
  /** ...a mouse this far. */
  mouseSlop: 6,
  /** The ring stays out of sight this long, so a quick tap does not flash it. */
  ringDelayMs: 120,
  /** The short buzz when a hold completes, where the device has one. */
  vibrateMs: 30,
} as const;

/**
 * - pressing: down, not yet long enough;
 * - held: down for HOLD.ms without moving (the ring is full);
 * - moved: moved more than the slop (before the hold: a scroll or a mouse drag; after: a drag).
 */
export type HoldPhase = "pressing" | "held" | "moved";

export type Hold = {
  phase: HoldPhase;
  startX: number;
  startY: number;
  /** A finger or a pen (true), or the mouse. */
  touch: boolean;
  /** Whether the hold was complete when the pointer moved away (a drag after a hold). */
  heldBeforeMove: boolean;
};

export type HoldEvent =
  | { type: "move"; x: number; y: number }
  /** How long the pointer has been down (ms), from a timer or a frame. */
  | { type: "time"; elapsed: number };

/** What a press was when the pointer came up. */
export type HoldOutcome = "tap" | "hold" | "moved";

export const startHold = (x: number, y: number, touch: boolean): Hold => ({
  phase: "pressing",
  startX: x,
  startY: y,
  touch,
  heldBeforeMove: false,
});

export const slopOf = (hold: Pick<Hold, "touch">) => (hold.touch ? HOLD.touchSlop : HOLD.mouseSlop);

/** The press after a reading: long enough is held, too far is moved (and stays moved). */
export const stepHold = (hold: Hold, event: HoldEvent): Hold => {
  if (hold.phase === "moved") return hold;
  if (event.type === "time")
    return hold.phase === "pressing" && event.elapsed >= HOLD.ms
      ? { ...hold, phase: "held" }
      : hold;
  const distance = Math.hypot(event.x - hold.startX, event.y - hold.startY);
  if (distance <= slopOf(hold)) return hold;
  return { ...hold, phase: "moved", heldBeforeMove: hold.phase === "held" };
};

/** Letting go: before HOLD.ms a tap, after it a hold, after moving neither. */
export const endHold = (hold: Hold): HoldOutcome =>
  hold.phase === "moved" ? "moved" : hold.phase === "held" ? "hold" : "tap";

/** How full the ring is (0 to 1) after `elapsed` ms. */
export const holdProgress = (elapsed: number) => Math.min(1, Math.max(0, elapsed / HOLD.ms));

/** Whether the ring shows yet (a quick tap never shows it). */
export const ringVisible = (elapsed: number) => elapsed >= HOLD.ringDelayMs;
