"use client";

import { useRouter } from "next/navigation";
import { useRef, type ReactNode } from "react";

/**
 * Swipe left or right anywhere on the day to go to the next or previous day (the arrows in the
 * header do the same). Horizontal scrollers inside can opt out with data-no-swipe.
 */
export const DaySwipe = ({
  prevHref,
  nextHref,
  children,
}: {
  prevHref: string;
  nextHref: string | null;
  children: ReactNode;
}) => {
  const router = useRouter();
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  return (
    <div
      onTouchStart={(event) => {
        const touch = event.touches[0];
        const target = event.target as HTMLElement;
        start.current =
          touch && event.touches.length === 1 && !target.closest("[data-no-swipe]")
            ? { x: touch.clientX, y: touch.clientY, t: Date.now() }
            : null;
      }}
      onTouchEnd={(event) => {
        const from = start.current;
        start.current = null;
        const touch = event.changedTouches[0];
        if (!from || !touch) return;
        const dx = touch.clientX - from.x;
        const dy = touch.clientY - from.y;
        if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - from.t > 800)
          return;
        if (dx > 0) router.push(prevHref);
        else if (nextHref) router.push(nextHref);
      }}
    >
      {children}
    </div>
  );
};
