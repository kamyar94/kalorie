import { describe, expect, it } from "vitest";

import {
  endHold,
  HOLD,
  holdProgress,
  ringVisible,
  startHold,
  stepHold,
  type Hold,
  type HoldEvent,
} from "./hold";

const run = (hold: Hold, ...events: HoldEvent[]) => events.reduce(stepHold, hold);
const time = (elapsed: number): HoldEvent => ({ type: "time", elapsed });
const move = (x: number, y: number): HoldEvent => ({ type: "move", x, y });

describe("hold timing", () => {
  it("is a hold at 450 ms without moving, and a tap just before", () => {
    expect(HOLD.ms).toBe(450);
    const touch = startHold(100, 100, true);
    expect(run(touch, time(449)).phase).toBe("pressing");
    expect(endHold(run(touch, time(449)))).toBe("tap");
    expect(run(touch, time(450)).phase).toBe("held");
    expect(endHold(run(touch, time(300), time(450)))).toBe("hold");
    // Later readings keep it held.
    expect(run(touch, time(450), time(2000)).phase).toBe("held");
  });

  it("fills the ring over the hold and keeps it hidden for a quick tap", () => {
    expect(holdProgress(-5)).toBe(0);
    expect(holdProgress(0)).toBe(0);
    expect(holdProgress(225)).toBeCloseTo(0.5);
    expect(holdProgress(450)).toBe(1);
    expect(holdProgress(900)).toBe(1);
    expect(ringVisible(HOLD.ringDelayMs - 1)).toBe(false);
    expect(ringVisible(HOLD.ringDelayMs)).toBe(true);
  });
});

describe("hold cancel", () => {
  it("lets a finger wander 10 px and a mouse 6 px", () => {
    const touch = startHold(100, 100, true);
    expect(run(touch, move(106, 108), time(450)).phase).toBe("held");
    expect(run(touch, move(107, 108)).phase).toBe("moved");
    const mouse = startHold(100, 100, false);
    expect(run(mouse, move(103, 105), time(450)).phase).toBe("held");
    expect(run(mouse, move(104, 105)).phase).toBe("moved");
  });

  it("cancels the hold when the pointer moves first, for good", () => {
    const moved = run(startHold(0, 0, true), move(0, 30));
    expect(moved.heldBeforeMove).toBe(false);
    // Coming back and waiting does not make it a hold.
    expect(run(moved, move(0, 0), time(1000)).phase).toBe("moved");
    expect(endHold(moved)).toBe("moved");
  });

  it("turns a completed hold into a drag when it moves after", () => {
    const dragged = run(startHold(50, 50, true), time(450), move(80, 50));
    expect(dragged.phase).toBe("moved");
    expect(dragged.heldBeforeMove).toBe(true);
    expect(endHold(dragged)).toBe("moved");
  });
});
