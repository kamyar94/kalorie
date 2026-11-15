"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { IconButton } from "@/components/ui/icon-button";
import type { NutrientCode } from "@/lib/contracts/nutrients";
import type { NutrientTarget } from "@/lib/contracts/targets";
import {
  dayName,
  formatAmount,
  mealsText,
  metricLabel,
  percentOf,
  SCALE_WORDS,
  targetWords,
  type DayLook,
  type YearDay,
} from "@/lib/trends/year";

import { lookClass } from "./year-colors";

/** Wide screens (the whole year fits): the box sits next to the square. */
const WIDE = "(min-width: 64rem)";
const subscribe = (change: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};
const useWide = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );

/** The square of a day in the year grid. */
export const squareOf = (date: string) =>
  document.querySelector<HTMLElement>(`[data-year-date="${date}"]`);

const GAP = 12;
const EDGE = 16;

const MACROS: [NutrientCode, string][] = [
  ["protein", "Protein"],
  ["carbs", "Carbs"],
  ["fat", "Fat"],
];

/**
 * A day's summary from the year (board 31): the date with the day before and after, the chosen
 * nutrient against its target with words for the kind of target, protein, carbs and fat, meals,
 * water and steps, and "Open this day". A press outside or Escape closes it and focus goes back
 * to the day's square. Centred over a light scrim on phones, next to the square on wide screens.
 */
export const YearDaySummary = ({
  date,
  day,
  look,
  metric,
  targets,
  today,
  withYear,
  prev,
  next,
  onGo,
  onClose,
}: {
  date: string | null;
  day: YearDay | undefined;
  look: DayLook | null;
  metric: NutrientCode;
  targets: Partial<Record<NutrientCode, NutrientTarget>>;
  today: string;
  withYear: boolean;
  prev: string | null;
  next: string | null;
  onGo: (date: string) => void;
  onClose: () => void;
}) => {
  const wide = useWide();
  const box = useRef<HTMLDivElement | null>(null);
  // The portal mounts the box a render after it opens: the anchor waits for it.
  const [mounted, setMounted] = useState(false);
  const attach = useCallback((element: HTMLDivElement | null) => {
    box.current = element;
    setMounted(!!element);
  }, []);
  // The day shown when the box closes: focus goes back to its square.
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (date) shown.current = date;
  }, [date]);

  // Wide screens: placed next to the day's square (before it is painted), beside it on the
  // right when there is room, else on the left, kept inside the window.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element || !mounted) return;
    const square = date && wide ? squareOf(date) : null;
    if (!square) {
      element.style.left = "";
      element.style.top = "";
      return;
    }
    const at = square.getBoundingClientRect();
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    let left = at.right + GAP;
    if (left + width > window.innerWidth - EDGE) left = at.left - GAP - width;
    left = Math.max(EDGE, Math.min(left, window.innerWidth - EDGE - width));
    const top = Math.max(
      EDGE,
      Math.min(at.top + at.height / 2 - height / 2, window.innerHeight - EDGE - height),
    );
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }, [date, wide, mounted]);

  const name = date ? dayName(date, withYear) : "";
  const label = metricLabel(metric);

  let amount = "";
  let detail = "";
  if (look && date) {
    switch (look.state) {
      case "none":
        amount = metric === "water" ? "No water logged" : "No meals logged";
        break;
      case "unknown":
        amount = `${label} not recorded`;
        detail = mealsText(day?.meals ?? 0);
        break;
      case "scale":
        amount = `${metric === "energy" ? "" : `${label} `}${formatAmount(metric, look.amount)}`;
        detail = `No target set · ${SCALE_WORDS[look.level]}`;
        break;
      case "bin": {
        const { target, upper, kind } = look.target;
        const safe =
          kind === "range" && upper ? ` (safe up to ${formatAmount(metric, upper)})` : "";
        amount = `${metric === "energy" ? "" : `${label} `}${formatAmount(metric, look.amount)}`;
        detail = `${look.percent}% of ${formatAmount(metric, target)}${safe} · ${targetWords(look.target, look.amount, look.percent)}`;
        break;
      }
    }
  }

  const steps = day?.steps ?? 0;
  const facts = [
    mealsText(day?.meals ?? 0).replace(/^n/, "N"),
    `water ${formatAmount("water", day?.waterMl ?? 0)}`,
    steps ? `${steps.toLocaleString("en-US")} steps` : "no steps logged",
  ].join(" · ");

  return (
    <Dialog.Root open={!!date} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="bg-scrim/60 data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in fixed inset-0 z-40 lg:bg-transparent" />
        <Dialog.Content
          ref={attach}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (shown.current) squareOf(shown.current)?.focus();
          }}
          data-testid="year-day"
          className={cn(
            "border-border bg-surface shadow-raised data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in fixed z-50 mx-auto flex max-w-sm flex-col gap-2.5 rounded-[var(--radius-card)] border p-3.5 outline-none",
            wide ? "w-[22rem]" : "inset-x-6 top-1/2 -translate-y-1/2",
          )}
        >
          <div className="flex items-center gap-1.5">
            <IconButton
              label="Previous day"
              variant="secondary"
              disabled={!prev}
              onClick={() => prev && onGo(prev)}
            >
              <ChevronLeft aria-hidden className="size-5" />
            </IconButton>
            <Dialog.Title className="text-headline min-w-0 flex-1 text-center" aria-live="polite">
              {name}
            </Dialog.Title>
            <IconButton
              label="Next day"
              variant="secondary"
              disabled={!next}
              onClick={() => next && onGo(next)}
            >
              <ChevronRight aria-hidden className="size-5" />
            </IconButton>
          </div>

          <div
            className="bg-bg flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[0.875rem] px-3 py-2.5"
            data-testid="year-day-metric"
          >
            {look && (
              <span
                aria-hidden
                className={cn("size-3.5 shrink-0 rounded-[4px]", lookClass(look))}
              />
            )}
            <span className="text-label tabular min-w-0 flex-1 text-[0.9375rem]">{amount}</span>
            {detail && <span className="text-caption text-muted tabular">{detail}</span>}
          </div>

          {(day?.meals ?? 0) > 0 && (
            <dl className="grid grid-cols-3 gap-2">
              {MACROS.map(([code, title]) => {
                const value = day?.[code as "protein" | "carbs" | "fat"] ?? null;
                const target = targets[code]?.target;
                return (
                  <div key={code} className="flex flex-col-reverse">
                    <dt className="text-caption text-muted">
                      {title}
                      {value !== null && target && target > 0
                        ? ` · ${percentOf(value, target)}%`
                        : ""}
                    </dt>
                    <dd className="text-headline tabular">
                      {value === null ? "–" : formatAmount(code, value)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}

          <p className="text-caption text-muted">{facts}</p>

          {date && (
            <Button asChild fullWidth className="rounded-full">
              <Link href={date === today ? "/today" : `/today?date=${date}`}>Open this day</Link>
            </Button>
          )}
          <Dialog.Close asChild>
            <Button variant="ghost" fullWidth className="text-muted rounded-full">
              Close
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
