import Link from "next/link";

import { cn } from "@/components/ui/cn";
import type { MoveWeekDayDto } from "@/lib/contracts/move";
import { moveHref } from "@/lib/move/week";
import { stripDay, stripLabel } from "@/lib/move/words";

import { Ring } from "./steps-ring";

/**
 * Monday to Sunday of the shown day's week (board 36): a small steps ring per day (green once the
 * goal is reached), days still to come outlined. A tap opens that day; the shown day is marked.
 */
export const WeekStrip = ({
  days,
  selected,
  today,
  goal,
  label,
}: {
  days: MoveWeekDayDto[];
  selected: string;
  today: string;
  goal: number;
  /** "Week of 16 to 22 November". */
  label: string;
}) => (
  <nav aria-label={label} data-testid="move-week-strip">
    <ul className="flex gap-0.5">
      {days.map((day) => {
        const { weekday, day: number } = stripDay(day.date);
        const current = day.date === selected;
        const content = (
          <>
            <span aria-hidden className="text-muted text-[0.6875rem] leading-4">
              {weekday}
            </span>
            {day.future ? (
              <span
                aria-hidden
                className="border-border text-muted grid size-[38px] place-items-center rounded-full border border-dashed text-[0.6875rem]"
              >
                {number}
              </span>
            ) : (
              <Ring size={38} stroke={4} steps={day.steps} goal={goal}>
                <span aria-hidden className="text-[0.6875rem] leading-none font-bold">
                  {number}
                </span>
              </Ring>
            )}
          </>
        );
        const box =
          "flex min-h-16 w-full flex-col items-center gap-1 rounded-[0.875rem] px-0 py-1.5";
        return (
          <li key={day.date} className="min-w-0 flex-1">
            {day.future ? (
              <span
                role="img"
                aria-label={stripLabel(day, goal)}
                data-strip-date={day.date}
                className={box}
              >
                {content}
              </span>
            ) : (
              <Link
                href={moveHref(day.date, today)}
                scroll={false}
                aria-label={stripLabel(day, goal)}
                aria-current={current ? "date" : undefined}
                data-strip-date={day.date}
                className={cn(box, current ? "bg-surface-2" : "hover:bg-surface-2/60")}
              >
                {content}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  </nav>
);
