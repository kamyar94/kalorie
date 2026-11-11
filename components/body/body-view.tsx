"use client";

import { ArrowDown, ArrowUp, ChevronRight, FileUp, Minus, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { sourceLabel } from "@/lib/contracts/activities";
import type { BodySummaryDto, MeasureStatDto } from "@/lib/contracts/body";
import { longDate, shortDate } from "@/lib/ui/format";

import { goalLine, showChange, showValue, VERDICT_CLASS, type Units } from "./format";
import { WeightChart } from "./weight-chart";

/** The four composition tiles of board 11, in its order. */
const COMPOSITION = ["body_fat", "muscle", "visceral_fat", "water"];

const listJoin = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

const changeText = (stat: MeasureStatDto, units: Units) =>
  stat.change === null || !stat.verdict
    ? "no earlier value"
    : `${showChange(stat.change, stat.unit, stat.decimals, units)} · ${stat.verdict}`;

/**
 * Body (board 11): the latest weight with its 30-day change judged from the goal, the weight
 * line and every weigh-in, body composition, tape measurements and ratios against a chosen day,
 * the body photos, the health profile, and imports.
 */
export const BodyView = ({
  summary,
  units,
  today,
  photos,
}: {
  summary: BodySummaryDto;
  units: Units;
  today: string;
  /** The body photos section (sessions and the comparison). */
  photos?: ReactNode;
}) => {
  const router = useRouter();
  const { show } = useToast();
  const sinceId = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const stat = (code: string) => summary.stats.find((s) => s.code === code) ?? null;
  const weight = stat("weight");
  const kg = (value: number) => showValue(value, "kg", 1, units);
  const composition = COMPOSITION.map(stat).filter((s): s is MeasureStatDto => s !== null);
  const tape = summary.stats.filter((s) => s.group === "tape" || s.group === "ratio");
  const order = (s: MeasureStatDto) => (s.group === "ratio" ? 1 : 0);
  tape.sort((a, b) => order(a) - order(b));
  const since = summary.since;

  const removeWeight = async (id: string) => {
    setBusy(id);
    try {
      await api.deleteMeasurement(id);
      show({ title: "Weigh-in removed", tone: "success" });
      router.refresh();
    } catch (error) {
      show({ title: "Not removed", body: (error as Error).message, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const w30 = summary.weight30;
  const TrendIcon = !w30 || w30.verdict === "steady" ? Minus : w30.change < 0 ? ArrowDown : ArrowUp;

  return (
    <>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title">Body</h1>
          <p className="text-caption text-muted" data-testid="body-goal">
            {goalLine(summary.goal, summary.goalRateKgPerWeek, units)}
          </p>
        </div>
        <Button asChild className="shrink-0 rounded-full">
          <Link href="/body/measure" aria-label="Log measurements">
            <Plus aria-hidden className="size-4" /> Log
          </Link>
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
        <div className="flex flex-col gap-4">
          <Card as="section" aria-labelledby="weight-heading" className="flex flex-col gap-2.5">
            <h2 id="weight-heading" className="sr-only">
              Weight
            </h2>
            {weight ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p data-testid="body-weight">
                    <span className="tabular text-4xl font-bold tracking-tight">
                      {showValue(weight.value, "kg", 1, units).split(" ")[0]}
                    </span>{" "}
                    <span className="text-label text-muted">
                      {units === "imperial" ? "lb" : "kg"}
                    </span>
                  </p>
                  {w30 && (
                    <p
                      className={cn(
                        "text-label flex items-center gap-1",
                        VERDICT_CLASS[w30.verdict],
                      )}
                      data-testid="body-weight-change"
                    >
                      <TrendIcon aria-hidden className="size-4" />
                      {kg(Math.abs(w30.change))} {w30.change < 0 ? "down" : "up"} in {w30.days} days
                      · {w30.verdict}
                    </p>
                  )}
                </div>
                <WeightChart weights={summary.weights} format={kg} />
                {summary.weightSources.length > 0 && (
                  <p className="text-caption text-muted">
                    From{" "}
                    {listJoin(
                      summary.weightSources.map((s) => (s === "Kal" ? "what you logged" : s)),
                    )}
                    .
                  </p>
                )}
                <details>
                  <summary className="text-label text-primary min-h-11 cursor-pointer py-2.5">
                    All weigh-ins ({summary.weightHistory.length})
                  </summary>
                  <ul className="flex flex-col" data-testid="weight-history">
                    {summary.weightHistory.map((entry) => (
                      <li
                        key={entry.id}
                        className="border-border flex min-h-11 items-center gap-3 border-t"
                      >
                        <span className="text-body min-w-0 flex-1">
                          {longDate(entry.date, today)}
                          <span className="text-caption text-muted block">
                            {sourceLabel(entry.source, entry.sourceApp)}
                          </span>
                        </span>
                        <span className="tabular text-label">{kg(entry.kg)}</span>
                        {entry.source !== "opengym" ? (
                          <button
                            type="button"
                            aria-label={`Remove the weigh-in of ${longDate(entry.date, today)}`}
                            disabled={busy !== null}
                            onClick={() => void removeWeight(entry.id)}
                            className="text-muted hover:bg-surface-2 grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-50"
                          >
                            <Trash2 aria-hidden className="size-4.5" />
                          </button>
                        ) : (
                          <span aria-hidden className="size-11 shrink-0" />
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            ) : (
              <p className="text-body text-muted">
                No weigh-ins yet. Log your weight, import your scale&apos;s file, or pair openGym.
              </p>
            )}
          </Card>

          <section aria-labelledby="composition-heading">
            <h2 id="composition-heading" className="sr-only">
              Body composition
            </h2>
            {composition.length ? (
              <div className="grid grid-cols-2 gap-2" data-testid="composition">
                {composition.map((s) => (
                  <Card key={s.code} className="p-3" padded={false}>
                    <p className="text-caption text-muted">{s.label}</p>
                    <p className="tabular text-[1.375rem] font-bold">
                      {showValue(s.value, s.unit, s.decimals, units)}
                    </p>
                    <p
                      className={cn(
                        "text-caption",
                        s.verdict ? VERDICT_CLASS[s.verdict] : "text-muted",
                      )}
                    >
                      {changeText(s, units)}
                    </p>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-caption text-muted">
                Body fat, muscle and more come from a smart scale: import its file or log them.
              </p>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <Card
            as="section"
            aria-labelledby="measurements-heading"
            className="flex flex-col gap-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id="measurements-heading" className="text-body font-semibold">
                Measurements
              </h2>
              <Link
                href="/body/measure"
                className="text-label text-primary -mr-2 inline-flex min-h-11 items-center rounded-full px-2"
              >
                Log new
              </Link>
            </div>
            {summary.sinceOptions.length > 1 && since && (
              <div className="flex items-center gap-2">
                <label htmlFor={sinceId} className="text-caption text-muted shrink-0">
                  Compare with
                </label>
                <select
                  id={sinceId}
                  value={since}
                  onChange={(event) => router.push(`/body?since=${event.target.value}`)}
                  className="border-border bg-surface text-label min-h-11 min-w-0 flex-1 rounded-[var(--radius-control)] border px-2.5"
                >
                  {summary.sinceOptions.map((date) => (
                    <option key={date} value={date}>
                      {longDate(date, today)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {tape.length ? (
              <table className="w-full border-collapse text-sm" data-testid="measurements">
                <thead>
                  <tr className="text-caption text-muted text-left">
                    <th scope="col" className="py-1 font-semibold">
                      Part
                    </th>
                    <th scope="col" className="py-1 text-right font-semibold">
                      Now
                    </th>
                    <th scope="col" className="py-1 text-right font-semibold">
                      {since ? `Since ${shortDate(since)}` : "Change"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tape.map((s) => (
                    <tr key={s.code} className="border-border border-t">
                      <th scope="row" className="py-2 text-left font-normal wrap-break-word">
                        {s.label}
                      </th>
                      <td className="tabular py-2 text-right font-semibold">
                        {showValue(s.value, s.unit, s.decimals, units)}
                      </td>
                      <td
                        className={cn(
                          "py-2 pl-2 text-right",
                          s.verdict ? VERDICT_CLASS[s.verdict] : "text-muted",
                        )}
                      >
                        {changeText(s, units)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-body text-muted">
                No tape measurements yet. Waist, hips and more: Log new shows where to measure.
              </p>
            )}
          </Card>

          {photos}

          <Link
            href="/body/health"
            className="border-border bg-surface shadow-card hover:bg-surface-2/40 flex items-center gap-3 rounded-[var(--radius-card)] border px-4 py-3.5"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body font-semibold">Health profile</span>
              <span className="text-caption text-muted">
                Conditions, allergies, medicines, notes
              </span>
            </span>
            <ChevronRight aria-hidden className="text-muted size-5" />
          </Link>
          <Button
            asChild
            variant="ghost"
            className="border-border rounded-full border border-dashed"
          >
            <Link href="/import?from=body">
              <FileUp aria-hidden className="size-4" /> Import a Renpho or Samsung Health file
            </Link>
          </Button>
        </div>
      </div>
    </>
  );
};
