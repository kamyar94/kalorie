"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import type { NutrientCode } from "@/lib/contracts/nutrients";
import { shiftLocalDate } from "@/lib/meals/time";
import {
  amountOf,
  BIN_LABELS,
  BIN_RANGES,
  countsText,
  dayLook,
  isLogged,
  lastDayOf,
  metricLabel,
  moveInGrid,
  SCALE_LEVELS,
  scaleMax,
  squareLabel,
  YEAR_BINS,
  yearCounts,
  yearGrid,
  yearStart,
  yearTarget,
  type DayLook,
  type YearData,
} from "@/lib/trends/year";

import { BIN_CLASS, lookClass, NONE_CLASS, SCALE_CLASS } from "./year-colors";
import { YearMetricMenu } from "./year-menu";
import { squareOf, YearDaySummary } from "./year-summary";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Each row of the grid: the weekday labels, then one column per week (13 px on phones). */
const ROW =
  "grid gap-[3px] grid-cols-[1.75rem_repeat(var(--weeks),13px)] lg:grid-cols-[1.75rem_repeat(var(--weeks),minmax(0,1fr))]";

const Swatch = ({ className }: { className: string }) => (
  <span aria-hidden className={cn("size-[11px] shrink-0 rounded-[3px]", className)} />
);

const LegendItem = ({ swatch, children }: { swatch: string; children: ReactNode }) => (
  <li className="text-muted inline-flex items-center gap-1 text-[11px] leading-4">
    <Swatch className={swatch} />
    {children}
  </li>
);

export type YearHref = (patch: { year?: number; metric?: NutrientCode }) => string;

/**
 * "Your year" at the top of Trends (boards 30 to 33): one square per day of a calendar year,
 * coloured by the day's amount of a nutrient against its target, with a menu of nutrients, a
 * year pager, the legend and the counts. A square opens the day's summary. The year and the
 * nutrient live in the address (?year=, ?metric=) so back and forward work.
 */
export const YearCard = ({ data, hrefFor }: { data: YearData; hrefFor: YearHref }) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const headingId = useId();
  const hintId = useId();
  const scroller = useRef<HTMLDivElement>(null);

  const { year, metric, today } = data;
  const currentYear = Number(today.slice(0, 4));
  const first = yearStart(year);
  const last = lastDayOf(year, today);
  const label = metricLabel(metric);

  const grid = useMemo(() => yearGrid(year), [year]);
  const byDate = useMemo(() => new Map(data.days.map((d) => [d.date, d])), [data.days]);
  const target = useMemo(
    () => yearTarget(metric, data.targets, data.waterGoalMl),
    [metric, data.targets, data.waterGoalMl],
  );
  const looks = useMemo(() => {
    const max = target
      ? 0
      : scaleMax(data.days.filter((d) => isLogged(d, metric)).map((d) => amountOf(d, metric)));
    const ctx = { today, metric, target, max };
    const out = new Map<string, DayLook>();
    for (const week of grid.weeks)
      for (const date of week) if (date) out.set(date, dayLook(date, byDate.get(date), ctx));
    return out;
  }, [grid, byDate, data.days, metric, target, today]);
  const counts = yearCounts(looks.values());
  const countLine = countsText(counts, !!target);

  // The square that takes the Tab key (roving focus) and the day whose summary is open; both
  // belong to the year they were picked in.
  const [focusState, setFocus] = useState({ year, date: last });
  const active = focusState.year === year && focusState.date <= last ? focusState.date : last;
  const [openState, setOpen] = useState<{ year: number; date: string } | null>(null);
  const open = openState?.year === year && openState.date <= last ? openState.date : null;
  const openDay = (date: string) => {
    setFocus({ year, date });
    setOpen({ year, date });
  };

  const go = (patch: { year?: number; metric?: NutrientCode }) =>
    startTransition(() => router.push(hrefFor(patch), { scroll: false }));

  // Phones: the strip starts at the latest week (December for past years).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const square = squareOf(lastDayOf(year, today));
    if (!square) return;
    const right = square.offsetLeft + square.offsetWidth + 2 * 16;
    el.scrollLeft = Math.max(0, right - el.clientWidth);
  }, [year, today]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const square = (event.target as HTMLElement).closest<HTMLElement>("[data-year-date]");
    const date = square?.dataset.yearDate;
    if (!date || date > last) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDay(date);
      return;
    }
    if (!/^(Arrow(Up|Down|Left|Right)|Home|End)$/.test(event.key)) return;
    event.preventDefault();
    const next = moveInGrid(date, event.key, first, last);
    if (!next) return;
    setFocus({ year, date: next });
    squareOf(next)?.focus();
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const date = (event.target as HTMLElement).closest<HTMLElement>("[data-year-date]")?.dataset
      .yearDate;
    if (date && date <= last) openDay(date);
  };

  const pagerButton = (to: number, enabled: boolean, name: string, icon: ReactNode) => (
    <button
      type="button"
      aria-label={`${name} (${to})`}
      aria-disabled={!enabled || undefined}
      onClick={() => enabled && go({ year: to })}
      className={cn(
        "bg-surface-2 text-text grid size-11 shrink-0 place-items-center rounded-full transition-colors",
        enabled ? "hover:bg-surface-3" : "cursor-not-allowed opacity-40",
      )}
    >
      {icon}
    </button>
  );

  return (
    <Card
      as="section"
      aria-labelledby={headingId}
      className="flex flex-col gap-3"
      data-testid="year-card"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-3 lg:grid-cols-[auto_auto_minmax(0,1fr)_auto]">
        <h2 id={headingId} className="text-headline">
          Your year
        </h2>
        <div className="col-start-2 row-start-1 flex items-center gap-1.5 lg:col-start-4">
          {pagerButton(
            year - 1,
            year > data.firstYear,
            "Previous year",
            <ChevronLeft aria-hidden className="size-5" />,
          )}
          <span
            className="text-label tabular min-w-11 text-center text-[0.9375rem]"
            aria-live="polite"
          >
            {year}
          </span>
          {pagerButton(
            year + 1,
            year < currentYear,
            "Next year",
            <ChevronRight aria-hidden className="size-5" />,
          )}
        </div>
        <div className="col-span-2 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:ml-3">
          <YearMetricMenu
            value={metric}
            targets={data.targets}
            waterGoalMl={data.waterGoalMl}
            onChange={(next) => go({ metric: next })}
          />
        </div>
      </div>

      <div className="relative">
        <div
          ref={scroller}
          data-testid="year-scroller"
          className="relative overflow-x-auto pt-0.5 pr-1 pb-1.5 lg:overflow-visible lg:pr-0"
        >
          <div
            role="grid"
            aria-label={`${label} by day, ${year}`}
            aria-describedby={hintId}
            aria-busy={pending || undefined}
            onKeyDown={onKeyDown}
            onClick={onClick}
            style={{ "--weeks": grid.weeks.length } as CSSProperties}
            className={cn(
              "flex w-max flex-col gap-[3px] transition-opacity lg:w-full",
              pending && "opacity-60",
            )}
          >
            <div aria-hidden className={ROW}>
              <span className="bg-surface sticky left-0 z-[1] h-3.5 shadow-[3px_0_0_var(--surface)]" />
              {grid.months.map((month) => (
                <span
                  key={month.label}
                  className="text-muted h-3.5 text-[11px] leading-[14px] whitespace-nowrap"
                  style={{ gridRow: 1, gridColumn: `${month.week + 2} / span 3` }}
                >
                  {month.label}
                </span>
              ))}
            </div>
            {WEEKDAYS.map((weekday, row) => (
              <div key={weekday} role="row" className={ROW}>
                <span
                  aria-hidden
                  className="bg-surface text-muted sticky left-0 z-[1] flex items-center pr-1 text-[10px] leading-[13px] shadow-[3px_0_0_var(--surface)]"
                >
                  {row % 2 === 0 && row < 6 ? weekday : ""}
                </span>
                {grid.weeks.map((week, w) => {
                  const date = week[row];
                  if (!date) return <span key={w} aria-hidden />;
                  const look = looks.get(date)!;
                  const future = look.state === "future";
                  return (
                    <div
                      key={date}
                      role="gridcell"
                      data-year-date={date}
                      data-state={look.state === "bin" ? look.bin : look.state}
                      tabIndex={future ? undefined : date === active ? 0 : -1}
                      aria-disabled={future || undefined}
                      aria-label={squareLabel(date, look, metric, byDate.get(date))}
                      className={cn(
                        "size-[13px] rounded-[3px] lg:aspect-square lg:h-auto lg:w-full",
                        lookClass(look),
                        !future && "cursor-pointer",
                        date === open && "outline-text outline-2 outline-offset-1",
                      )}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <span
          aria-hidden
          className="from-surface pointer-events-none absolute inset-y-0 left-7 w-5 bg-gradient-to-r to-transparent lg:hidden"
        />
      </div>

      <p className="text-caption text-muted -mt-1">
        <span className="lg:hidden">
          Swipe the squares for earlier months. Tap a day for its summary.
        </span>
        <span className="hidden lg:inline">Click a day for its summary.</span>
      </p>
      <p id={hintId} className="sr-only">
        Arrow keys move by day and by week, Enter opens the day&apos;s summary.
      </p>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
        {target ? (
          <ul aria-label="Colours" className="flex flex-wrap gap-x-2.5 gap-y-1.5">
            <LegendItem swatch={NONE_CLASS}>
              {counts.unknown
                ? "No meals or not recorded"
                : metric === "water"
                  ? "Nothing logged"
                  : "No meals"}
            </LegendItem>
            {YEAR_BINS.map((bin) => (
              <LegendItem key={bin} swatch={BIN_CLASS[bin]}>
                {BIN_LABELS[bin]}
                <span className="hidden lg:inline">&nbsp;· {BIN_RANGES[bin]}</span>
              </LegendItem>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-1.5">
            <ul aria-label="Colours" className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <LegendItem swatch={NONE_CLASS}>
                {counts.unknown ? "No meals or not recorded" : "No meals"}
              </LegendItem>
              <li className="text-muted inline-flex items-center gap-[3px] text-[11px] leading-4">
                <span className="mr-0.5">Less</span>
                {SCALE_LEVELS.map((level) => (
                  <Swatch key={level} className={SCALE_CLASS[level]} />
                ))}
                <span className="ml-0.5">More</span>
              </li>
            </ul>
            <p className="text-caption text-muted">
              No target set: each day is shaded against your highest day of the year, lighter is
              less.
            </p>
          </div>
        )}
        <p className="text-label shrink-0" data-testid="year-counts">
          {countLine.logged}
          {countLine.rest && <span className="text-muted font-normal"> · {countLine.rest}</span>}
        </p>
      </div>
      {target && (
        <p className="text-caption text-muted -mt-1">
          Compared with your current targets
          {metric === "water" ? "; each day's water goal includes its activity, as on Today" : ""}.
        </p>
      )}

      <YearDaySummary
        date={open}
        day={open ? byDate.get(open) : undefined}
        look={open ? (looks.get(open) ?? null) : null}
        metric={metric}
        targets={data.targets}
        today={today}
        withYear={year !== currentYear}
        prev={open && open > first ? shiftLocalDate(open, -1) : null}
        next={open && open < last ? shiftLocalDate(open, 1) : null}
        onGo={openDay}
        onClose={() => setOpen(null)}
      />
    </Card>
  );
};
