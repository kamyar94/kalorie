"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { formatMinutes, formatSteps } from "@/lib/contracts/activities";
import type { EveryDayMonthDto, EveryDayRowDto, MoveGoals } from "@/lib/contracts/move";
import { moveHref } from "@/lib/move/week";
import { everyDayLabel, isEmptyRow } from "@/lib/move/words";

const BAR: Record<keyof MoveGoals, string> = {
  steps: "bg-primary",
  activeMinutes: "bg-protein",
  activeKcal: "bg-energy",
};

/** One number of a row with a small bar against its goal; `spoken` follows it for screen readers. */
const Cell = ({
  kind,
  value,
  goal,
  text,
  spoken,
}: {
  kind: keyof MoveGoals;
  value: number | null;
  goal: number;
  text: string;
  spoken: string;
}) => (
  <span className="flex min-w-0 flex-col gap-1">
    <span className="tabular text-[0.8125rem] leading-tight font-bold">
      {value === null ? <span aria-hidden>–</span> : text}
      <span className="sr-only">{spoken}</span>
    </span>
    <span aria-hidden className="bg-surface-3 block h-1.5 overflow-hidden rounded-full">
      {value !== null && value > 0 && (
        <span
          className={cn("block h-full rounded-full", BAR[kind])}
          style={{ width: `${Math.min(100, Math.round((value / goal) * 100))}%` }}
        />
      )}
    </span>
  </span>
);

const Row = ({
  row,
  today,
  selected,
  goals,
}: {
  row: EveryDayRowDto;
  today: string;
  selected: boolean;
  goals: MoveGoals;
}) => {
  const label = everyDayLabel(row.date, today);
  if (isEmptyRow(row))
    return (
      <li
        className={cn(
          "border-border flex min-h-13 items-center gap-2.5 border-t",
          selected && "bg-surface-2 -mx-4 px-4",
        )}
        aria-current={selected ? "date" : undefined}
      >
        <span className="text-muted w-[4.75rem] shrink-0 text-sm">{label}</span>
        <span className="text-caption text-muted flex-1">No data from the phone</span>
      </li>
    );
  return (
    <li className={cn("border-border border-t", selected && "bg-surface-2 -mx-4 px-4")}>
      <Link
        href={moveHref(row.date, today)}
        aria-current={selected ? "date" : undefined}
        className="flex min-h-15 items-center gap-2.5"
      >
        <span className="w-[4.75rem] shrink-0 text-sm font-semibold">
          {label}
          <span className="sr-only">:</span>
        </span>
        <span className="grid min-w-0 flex-1 grid-cols-3 gap-2">
          <Cell
            kind="steps"
            value={row.steps}
            goal={goals.steps}
            text={row.steps === null ? "–" : formatSteps(row.steps)}
            spoken={row.steps === null ? " no steps," : " steps,"}
          />
          <Cell
            kind="activeMinutes"
            value={row.activeMinutes}
            goal={goals.activeMinutes}
            text={row.activeMinutes === null ? "–" : formatMinutes(row.activeMinutes)}
            spoken={row.activeMinutes === null ? " no active time," : " active,"}
          />
          <Cell
            kind="activeKcal"
            value={row.activeKcal}
            goal={goals.activeKcal}
            text={row.activeKcal === null ? "–" : `${row.activeKcal.toLocaleString("en-US")} kcal`}
            spoken={row.activeKcal === null ? " no activity calories" : " from activity"}
          />
        </span>
        <ChevronRight aria-hidden className="text-muted size-4 shrink-0" />
      </Link>
    </li>
  );
};

/**
 * Move's "Every day" (board 40): this month's days, newest first, with the phone's steps, active
 * time and activity calories and a small bar against each goal; the shown day highlighted (today
 * on today's Move); "No data from the phone" for an empty day; "Earlier days" adds the month
 * before. A row opens that day.
 */
export const EveryDay = ({
  initial,
  today,
  selected,
  goals,
}: {
  initial: EveryDayMonthDto;
  today: string;
  /** The day Move shows. */
  selected: string;
  goals: MoveGoals;
}) => {
  const { show } = useToast();
  const [months, setMonths] = useState([initial]);
  const [loading, setLoading] = useState(false);
  const last = months.at(-1)!;

  const earlier = async () => {
    if (!last.earlier) return;
    setLoading(true);
    try {
      const month = await api.moveDays(last.earlier);
      setMonths((list) => [...list, month]);
    } catch (error) {
      show({ title: "Earlier days not loaded", body: (error as Error).message, tone: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      as="section"
      aria-labelledby="every-day-heading"
      className="flex flex-col gap-2"
      data-testid="every-day"
    >
      <div className="flex items-center gap-2">
        <h2 id="every-day-heading" className="text-headline flex-1">
          Every day
        </h2>
        <span className="text-caption text-muted">{initial.label}</span>
      </div>
      <div aria-hidden className="text-caption text-muted flex items-center gap-2.5">
        <span className="w-[4.75rem] shrink-0" />
        <span className="grid min-w-0 flex-1 grid-cols-3 gap-2">
          <span>Steps</span>
          <span>Active time</span>
          <span>Activity kcal</span>
        </span>
        <span className="w-4 shrink-0" />
      </div>
      {months.map((month, i) => (
        <div key={month.month} data-testid={`every-day-${month.month}`}>
          {i > 0 && <h3 className="text-label mt-3 mb-1">{month.label}</h3>}
          {month.days.length ? (
            <ul className="flex flex-col">
              {month.days.map((row) => (
                <Row
                  key={row.date}
                  row={row}
                  today={today}
                  selected={row.date === selected}
                  goals={goals}
                />
              ))}
            </ul>
          ) : (
            <p className="text-caption text-muted">Nothing this month yet.</p>
          )}
        </div>
      ))}
      {last.earlier && (
        <Button
          variant="secondary"
          className="mt-1 rounded-full"
          loading={loading}
          onClick={() => void earlier()}
        >
          Earlier days
        </Button>
      )}
    </Card>
  );
};
