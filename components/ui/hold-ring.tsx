"use client";

import { useEffect, useRef } from "react";

import { HOLD, holdProgress, ringVisible } from "@/lib/ui/hold";

import { cn } from "./cn";

const RADIUS = 22;
const LENGTH = 2 * Math.PI * RADIUS;

/**
 * The ring that fills on a photo while it is held (board 50): full after HOLD.ms, out of sight
 * for a quick tap. Drawn frame by frame from the time the press started (not a CSS animation, so
 * it keeps its real length when the device asks for less motion).
 */
export const HoldRing = ({
  startedAt,
  held,
  className,
}: {
  /** performance.now() when the press started. */
  startedAt: number;
  /** The hold is complete: the ring stays full. */
  held: boolean;
  className?: string;
}) => {
  const svg = useRef<SVGSVGElement>(null);
  const arc = useRef<SVGCircleElement>(null);

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const elapsed = held ? HOLD.ms : performance.now() - startedAt;
      svg.current?.style.setProperty("opacity", ringVisible(elapsed) ? "1" : "0");
      arc.current?.setAttribute("stroke-dashoffset", String(LENGTH * (1 - holdProgress(elapsed))));
      if (elapsed < HOLD.ms) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [startedAt, held]);

  return (
    <svg
      ref={svg}
      aria-hidden
      viewBox="0 0 100 100"
      className={cn("pointer-events-none absolute inset-0 size-full opacity-0", className)}
      data-testid="hold-ring"
      data-held={held || undefined}
    >
      <circle cx="50" cy="50" r={RADIUS} className="fill-black/55" />
      <circle cx="50" cy="50" r={RADIUS} fill="none" className="stroke-white/35" strokeWidth="6" />
      <circle
        ref={arc}
        cx="50"
        cy="50"
        r={RADIUS}
        fill="none"
        className="stroke-primary"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={LENGTH}
        strokeDashoffset={LENGTH}
        transform="rotate(-90 50 50)"
      />
    </svg>
  );
};
