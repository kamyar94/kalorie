"use client";

import { ChevronRight, Droplet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { formatMinutes } from "@/lib/contracts/activities";
import type { WaterEntryDto } from "@/lib/contracts/water";
import { goalLitres, litres } from "@/lib/meals/hydration";
import { waterEntryName, waterEntryPlace, waterTotalMl } from "@/lib/meals/water";

import { useWaterDay } from "./water-day";

const QUICK = [
  { ml: 250, label: "+ Glass, 250 ml" },
  { ml: 500, label: "+ Bottle, 500 ml" },
] as const;

/** Entries shown before "Show all": the latest ones. */
const SHOWN = 4;

// Rows reach the card's edges, as on board 29.
const rowClass =
  "border-border hover:bg-surface-2 -mx-4 flex min-h-12 w-[calc(100%+2rem)] items-center gap-2.5 border-t px-4 py-1.5 text-left";

const Row = ({ entry }: { entry: WaterEntryDto }) => {
  const place = waterEntryPlace(entry);
  return (
    <>
      <span className="tabular text-caption text-muted w-12 shrink-0">{entry.localTime}</span>
      <span className="min-w-0 flex-1 text-[0.9375rem] wrap-break-word" dir="auto">
        <span aria-hidden>{entry.emoji} </span>
        {waterEntryName(entry)}
        {place && <span className="text-caption text-muted"> · {place}</span>}
      </span>
      <span className="tabular shrink-0 text-[0.9375rem] font-semibold">
        {entry.waterMl.toLocaleString("en-US")} ml
      </span>
      <ChevronRight aria-hidden className="text-muted size-4 shrink-0" />
    </>
  );
};

/**
 * The day's water from drinks against the goal (board 29): the entries, oldest first (the latest
 * few, with "Show all" on a busy day), two buttons that log a glass or a bottle at once (a meal
 * with one item, Water, kind drink, no energy; at 12:00 on an earlier day) and "+ Other amount".
 * Water added here opens the water sheet; a drink inside a meal opens that meal. Timed activity
 * raises the day's goal (lib/move/water.ts); the caption then says how the goal is made up. The
 * entries, the total and the sheet come from the Today screen's WaterDayProvider.
 */
export const WaterCard = ({
  baseMl,
  activityMl = 0,
  activityMinutes = 0,
}: {
  /** The hydration target. */
  baseMl: number;
  /** The estimate for the day's activity, and the minutes it is for. */
  activityMl?: number;
  activityMinutes?: number;
}) => {
  const day = useWaterDay();
  const [all, setAll] = useState(false);
  if (!day) return null;
  const { entries, date, today, busy, logNow, openSheet } = day;
  const goalMl = baseMl + activityMl;
  const totalMl = waterTotalMl(entries);
  const percent = goalMl > 0 ? Math.min(100, (totalMl / goalMl) * 100) : 0;
  const shown = all ? entries : entries.slice(-SHOWN);

  return (
    <Card
      as="section"
      aria-labelledby="water-heading"
      className="flex flex-col gap-2.5"
      data-testid="water-card"
    >
      <div className="flex items-center gap-2.5">
        <Droplet aria-hidden className="text-water size-5.5 shrink-0" />
        <h2 id="water-heading" className="text-body flex-1 font-semibold">
          Water
        </h2>
        <p className="text-[0.9375rem] font-semibold" data-testid="water-total">
          <span className="tabular text-xl">{litres(totalMl)}</span>{" "}
          <span className="text-muted font-normal">of {goalLitres(goalMl)} L</span>
        </p>
      </div>
      <div
        role="progressbar"
        aria-label="Water today"
        aria-valuemin={0}
        aria-valuemax={goalMl}
        aria-valuenow={Math.min(totalMl, goalMl)}
        aria-valuetext={`${litres(totalMl)} of ${goalLitres(goalMl)} litres`}
        className="bg-surface-2 h-2.5 overflow-hidden rounded-full"
      >
        <div className="bg-water h-full rounded-full" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-caption text-muted" data-testid="water-caption">
        {activityMl > 0
          ? `${date === today ? "Goal today" : "Goal that day"}: ${goalLitres(baseMl)} L, plus an estimated ${(activityMl / 1000).toFixed(1)} L for ${formatMinutes(activityMinutes)} of activity. Drinks in your meals count; alcohol does not.`
          : "From the drinks in your meals. Alcohol does not count."}
      </p>

      {entries.length > 0 && (
        <div>
          <ul
            id="water-entries"
            aria-label={date === today ? "Today's water" : "Water that day"}
            className="flex flex-col"
          >
            {shown.map((entry) => (
              <li key={entry.itemId} data-testid="water-entry">
                {entry.standalone ? (
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    onClick={() => openSheet(entry)}
                    className={rowClass}
                  >
                    <Row entry={entry} />
                  </button>
                ) : (
                  <Link href={`/meals/${entry.mealId}`} className={rowClass}>
                    <Row entry={entry} />
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {entries.length > SHOWN && (
            <button
              type="button"
              aria-expanded={all}
              aria-controls="water-entries"
              onClick={() => setAll((open) => !open)}
              className="text-label text-primary border-border -mx-4 min-h-11 w-[calc(100%+2rem)] border-t px-4 text-left"
            >
              {all ? "Show fewer" : `Show all ${entries.length}`}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {QUICK.map((option) => (
          <button
            key={option.ml}
            type="button"
            disabled={busy !== null}
            aria-busy={busy === option.ml || undefined}
            onClick={() => void logNow(option.ml)}
            className="text-label bg-surface-2 hover:bg-surface-3 min-h-11 flex-1 rounded-full px-2 disabled:opacity-60"
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          id="water-other"
          aria-haspopup="dialog"
          onClick={() => openSheet(null)}
          className="text-label border-primary text-primary hover:bg-primary-soft min-h-11 flex-1 basis-full rounded-full border border-dashed px-3 sm:basis-auto"
        >
          + Other amount
        </button>
      </div>
    </Card>
  );
};
