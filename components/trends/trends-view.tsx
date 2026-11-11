"use client";

import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { NutrientBar } from "@/components/ui/nutrient-bar";
import type { NutrientColor } from "@/components/ui/nutrient-ring";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { MEAL_SLOT_LABELS, type MealSlot } from "@/lib/contracts/meals";
import { formatNutrient, type NutrientCode } from "@/lib/contracts/nutrients";
import { shiftLocalDate } from "@/lib/meals/time";
import {
  MIN_DAYS_FOR_PATTERN,
  RANGE_DAYS,
  type TrendRange,
  type TrendsData,
} from "@/lib/trends/compute";
import { dayTitle, formatKcal, shortDate, weekdayLetter } from "@/lib/ui/format";

import { BarChart, ChartTable, LineChart, type BarDatum } from "./charts";

const RANGE_LABELS: Record<TrendRange, string> = { day: "Day", week: "Week", month: "Month" };

/** Always listed; supper, drink and dessert only once the period has one. */
const MAIN_SLOTS = new Set<MealSlot>(["breakfast", "lunch", "dinner", "snack"]);

const hrefFor = (range: TrendRange, end: string, today: string) =>
  `/trends?range=${range}${end === today ? "" : `&end=${end}`}`;

const Section = ({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <Card as="section" aria-label={title} className={className}>
    <h2 className="text-headline mb-3">{title}</h2>
    {children}
  </Card>
);

/** Trends (docs/DESIGN.md section 7): day, week and month views. */
export const TrendsView = ({ data, today }: { data: TrendsData; today: string }) => {
  const router = useRouter();
  const days = RANGE_DAYS[data.range];
  const prevEnd = shiftLocalDate(data.end, -days);
  const nextEnd = data.end < today ? shiftLocalDate(data.end, days) : null;
  const period =
    data.range === "day"
      ? dayTitle(data.end, today)
      : `${shortDate(data.start)} – ${shortDate(data.end)}`;
  const target = (code: NutrientCode) => data.targets[code]?.target ?? null;

  const perDay = (code: NutrientCode): BarDatum[] =>
    data.days.map((d, i) => ({
      key: d.date,
      label:
        data.range === "week"
          ? weekdayLetter(d.date)
          : i % 5 === 0 || i === data.days.length - 1
            ? shortDate(d.date).replace(/^\w+ /, "")
            : "",
      title: `${weekdayLetter(d.date)}, ${shortDate(d.date)}`,
      value: d.meals ? (d.totals[code] ?? 0) : null,
    }));

  const hours: BarDatum[] = data.byHour.map((value, hour) => ({
    key: String(hour),
    label: hour % 6 === 0 ? `${String(hour).padStart(2, "0")}` : "",
    title: `${String(hour).padStart(2, "0")}:00 – ${String(hour).padStart(2, "0")}:59`,
    value: value > 0 ? value : null,
  }));

  const flagged = data.nutrients.filter((n) => n.verdict !== "ok");
  const enoughDays = data.loggedDays >= Math.min(MIN_DAYS_FOR_PATTERN, days);
  const maxSlot = Math.max(1, ...data.bySlot.map((s) => s.energy));

  return (
    <>
      <header className="flex flex-col gap-3">
        <h1 className="text-title">Trends</h1>
        <SegmentedControl
          label="Period"
          value={data.range}
          onValueChange={(range) => router.push(hrefFor(range, data.end, today))}
          options={(["day", "week", "month"] as const).map((r) => ({
            value: r,
            label: RANGE_LABELS[r],
          }))}
          className="max-w-sm"
        />
        <div className="flex items-center gap-1">
          <Link
            href={hrefFor(data.range, prevEnd, today)}
            aria-label="Earlier period"
            className="hover:bg-surface-2 -ml-2 grid size-11 place-items-center rounded-full"
          >
            <ChevronLeft aria-hidden className="size-6" />
          </Link>
          <p className="text-label min-w-0 flex-1 text-center sm:flex-none" aria-live="polite">
            {period}
          </p>
          {nextEnd ? (
            <Link
              href={hrefFor(data.range, nextEnd > today ? today : nextEnd, today)}
              aria-label="Later period"
              className="hover:bg-surface-2 grid size-11 place-items-center rounded-full"
            >
              <ChevronRight aria-hidden className="size-6" />
            </Link>
          ) : (
            <span aria-hidden className="size-11" />
          )}
        </div>
      </header>

      {!data.loggedDays ? (
        <EmptyState
          className="mt-6"
          icon={<BarChart3 className="size-7" />}
          title="Nothing logged in this period"
          body="Log meals and Kal shows your energy, protein and other nutrients against your targets here."
        />
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
          <Section title={data.range === "day" ? "The day" : "Daily average"}>
            <div className="flex items-end gap-3">
              <p className="tabular text-display" data-testid="average-energy">
                {formatKcal(data.average.energy)}
              </p>
              <p className="text-body text-muted pb-1">
                kcal{target("energy") ? ` of ${formatKcal(target("energy"))}` : ""}
              </p>
            </div>
            {data.range !== "day" && (
              <p className="text-caption text-muted mt-1">
                {data.loggedDays} of {days} days logged; averages count logged days only.
              </p>
            )}
            <div className="mt-4 grid grid-cols-3 gap-3">
              {(
                [
                  ["protein", "Protein", "protein", "min"],
                  ["carbs", "Carbs", "carbs", "goal"],
                  ["fat", "Fat", "fat", "goal"],
                ] as [NutrientCode, string, NutrientColor, "min" | "goal"][]
              ).map(([code, label, color, kind]) => (
                <NutrientBar
                  key={code}
                  stacked
                  label={label}
                  value={data.average[code] ?? 0}
                  target={target(code)}
                  unit="g"
                  color={color}
                  kind={kind}
                />
              ))}
            </div>
          </Section>

          {data.range !== "day" && (
            <Section title="Calories per day">
              <BarChart
                data={perDay("energy")}
                unit="kcal"
                color="energy"
                target={target("energy")}
                label="Calories per day"
              />
            </Section>
          )}

          {data.range !== "day" && (
            <Section title="Protein, carbs and fat per day" className="md:col-span-2">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {(
                  [
                    ["protein", "Protein", "protein"],
                    ["carbs", "Carbs", "carbs"],
                    ["fat", "Fat", "fat"],
                  ] as [NutrientCode, string, NutrientColor][]
                ).map(([code, label, color]) => (
                  <div key={code}>
                    <h3 className="text-label mb-1">{label} (g)</h3>
                    <BarChart
                      data={perDay(code)}
                      unit="g"
                      color={color}
                      target={target(code)}
                      label={`${label} per day`}
                      height={128}
                    />
                  </div>
                ))}
              </div>
            </Section>
          )}

          <Section title={data.range === "day" ? "By meal" : "Average by meal"}>
            <ul className="flex flex-col gap-3">
              {data.bySlot
                .filter((slot) => slot.meals > 0 || MAIN_SLOTS.has(slot.slot))
                .map((slot) => (
                  <li key={slot.slot}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-label">{MEAL_SLOT_LABELS[slot.slot]}</span>
                      <span className="text-caption text-muted tabular">
                        <span className="text-label text-text">{formatKcal(slot.energy)}</span> kcal
                        · {Math.round(slot.share * 100)}%
                      </span>
                    </div>
                    <div
                      aria-hidden
                      className="bg-surface-3 mt-1.5 h-2 overflow-hidden rounded-full"
                    >
                      <div
                        className="bg-energy h-full rounded-full"
                        style={{ width: `${(slot.energy / maxSlot) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
            </ul>
          </Section>

          <Section title="Time of day">
            <BarChart
              data={hours}
              unit="kcal"
              color="primary"
              label={data.range === "day" ? "Calories by hour" : "Average calories by hour"}
              height={132}
            />
          </Section>

          <Section title="Nutrients against your targets">
            {!enoughDays ? (
              <p className="text-body text-muted">
                Log meals on at least {MIN_DAYS_FOR_PATTERN} days to see which nutrients are usually
                low or high.
              </p>
            ) : flagged.length ? (
              <ul className="flex flex-col gap-2" data-testid="flagged-nutrients">
                {flagged.map((n) => (
                  <li key={n.code} className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className={
                        n.verdict === "low"
                          ? "bg-warning-soft text-on-warning-soft grid size-8 place-items-center rounded-full"
                          : "bg-danger-soft text-on-danger-soft grid size-8 place-items-center rounded-full"
                      }
                    >
                      {n.verdict === "low" ? (
                        <ArrowDown className="size-4" />
                      ) : (
                        <ArrowUp className="size-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-label block">
                        {n.name}: usually {n.verdict === "low" ? "low" : "high"}
                      </span>
                      <span className="text-caption text-muted">
                        {formatNutrient(n.code, n.average)} a day on average, target{" "}
                        {formatNutrient(n.code, n.target)}
                      </span>
                    </span>
                    <span className="tabular text-label">{Math.round(n.ratio * 100)}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body inline-flex items-center gap-2">
                <CircleCheck aria-hidden className="text-primary size-5" /> Everything with a target
                is close to it.
              </p>
            )}
            {enoughDays && data.nutrients.length > 0 && (
              <div className="mt-3">
                <ChartTable
                  caption="Average per day against the targets"
                  head={["Nutrient", "Average", "Target", "Share"]}
                  rows={data.nutrients.map((n) => [
                    n.name,
                    formatNutrient(n.code, n.average),
                    formatNutrient(n.code, n.target),
                    `${Math.round(n.ratio * 100)}%`,
                  ])}
                />
              </div>
            )}
          </Section>

          <Section title="Top foods">
            {data.topFoods.length ? (
              <ol className="flex flex-col">
                {data.topFoods.map((food, i) => (
                  <li
                    key={`${food.foodId ?? food.name}-${i}`}
                    className="border-border flex items-center gap-3 border-b py-2 last:border-b-0"
                  >
                    <span className="text-caption text-muted tabular w-5">{i + 1}</span>
                    <span className="text-body min-w-0 flex-1 truncate" dir="auto">
                      {food.name}
                    </span>
                    <span className="text-caption text-muted tabular shrink-0 text-right">
                      {food.times}× · {formatKcal(food.energy)} kcal
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-body text-muted">No foods yet.</p>
            )}
          </Section>

          {data.weight.length > 1 && (
            <Section title="Weight" className="md:col-span-2">
              <LineChart
                points={data.weight.map((w) => ({
                  key: w.date,
                  label: shortDate(w.date),
                  title: shortDate(w.date),
                  value: w.kg,
                }))}
                unit="kg"
                label="Body weight"
              />
            </Section>
          )}
        </div>
      )}
    </>
  );
};
