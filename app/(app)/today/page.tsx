import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AutoRefresh } from "@/components/app/auto-refresh";
import { TodayCapture } from "@/components/app/today-capture";
import { DayPlanSection } from "@/components/today/day-plan";
import { DaySwipe } from "@/components/today/day-swipe";
import { Timeline } from "@/components/today/timeline";
import { WaterCard } from "@/components/today/water-card";
import { Card } from "@/components/ui/card";
import { NutrientBar } from "@/components/ui/nutrient-bar";
import { NutrientRing } from "@/components/ui/nutrient-ring";
import { requireUser } from "@/lib/auth/session";
import { sumNutrients } from "@/lib/contracts/nutrients";
import { getDayPlan } from "@/lib/integrations/day";
import { listMealsForDay } from "@/lib/meals/service";
import { isLocalDate, shiftLocalDate } from "@/lib/meals/time";
import { getTargets } from "@/lib/targets/service";
import { dayTitle, formatKcal, longDate } from "@/lib/ui/format";
import { viewerToday } from "@/lib/ui/viewer-time";

export const metadata: Metadata = { title: "Today" };

const arrowClass =
  "hover:bg-surface-2 grid size-11 shrink-0 place-items-center rounded-full transition-colors";

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const user = await requireUser();
  const today = await viewerToday(user.timeZone);
  const raw = (await searchParams).date;
  const requested = Array.isArray(raw) ? raw[0] : raw;
  // The future has nothing to log yet.
  const date = isLocalDate(requested) && requested <= today ? requested : today;

  const [meals, { targets, hydration }, plan] = await Promise.all([
    listMealsForDay(user.id, date),
    getTargets(user.id),
    getDayPlan(user.id, date, { today }),
  ]);
  const totals = sumNutrients(meals.map((m) => m.totals));
  const waterMl = meals.reduce((sum, meal) => sum + meal.waterMl, 0);
  const pending = meals.some((m) => m.status === "queued" || m.status === "analysing");
  const burned = plan.workouts.reduce((sum, w) => sum + (w.kcalEstimate ?? 0), 0);
  const energyTarget = targets.energy?.target ?? null;
  const left = energyTarget ? energyTarget - (totals.energy ?? 0) + burned : null;
  const prevHref = `/today?date=${shiftLocalDate(date, -1)}`;
  const nextHref =
    date < today
      ? shiftLocalDate(date, 1) === today
        ? "/today"
        : `/today?date=${shiftLocalDate(date, 1)}`
      : null;

  return (
    <DaySwipe prevHref={prevHref} nextHref={nextHref}>
      <header className="flex items-center gap-1">
        <Link href={prevHref} aria-label="Previous day" className={`${arrowClass} -ml-2`}>
          <ChevronLeft aria-hidden className="size-6" />
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="text-title">{dayTitle(date, today)}</h1>
          <p className="text-caption text-muted">{longDate(date, today)}</p>
        </div>
        {nextHref ? (
          <Link href={nextHref} aria-label="Next day" className={`${arrowClass} -mr-2`}>
            <ChevronRight aria-hidden className="size-6" />
          </Link>
        ) : (
          <span aria-hidden className="size-11" />
        )}
      </header>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:items-start md:gap-6">
        <div className="flex flex-col gap-4 md:sticky md:top-6">
          <Card
            as="section"
            aria-label="Day summary"
            className="flex flex-col items-center gap-5 p-5"
          >
            <NutrientRing
              value={totals.energy ?? 0}
              target={energyTarget}
              label="Calories"
              unit="kcal"
              color="energy"
            />
            {left !== null && (
              <p className="text-caption text-muted -mt-2" data-testid="energy-left">
                {left >= 0 ? (
                  <>
                    <span className="tabular text-label text-text">{formatKcal(left)}</span> kcal
                    left
                  </>
                ) : (
                  <>
                    <span className="tabular text-label text-danger">{formatKcal(-left)}</span> kcal
                    over
                  </>
                )}
                {burned > 0 && " (with the workout estimate)"}
              </p>
            )}
            <div className="grid w-full grid-cols-3 gap-3">
              <NutrientBar
                stacked
                label="Protein"
                value={totals.protein ?? 0}
                target={targets.protein?.target ?? null}
                unit="g"
                color="protein"
                kind="min"
              />
              <NutrientBar
                stacked
                label="Carbs"
                value={totals.carbs ?? 0}
                target={targets.carbs?.target ?? null}
                unit="g"
                color="carbs"
              />
              <NutrientBar
                stacked
                label="Fat"
                value={totals.fat ?? 0}
                target={targets.fat?.target ?? null}
                unit="g"
                color="fat"
              />
            </div>
          </Card>
          <WaterCard date={date} today={today} totalMl={waterMl} goalMl={hydration.goalMl} />
          <DayPlanSection plan={plan} />
        </div>

        <section aria-labelledby="meals-heading">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id="meals-heading" className="text-headline">
              Meals
            </h2>
            <Link
              href={date === today ? "/add" : `/add?date=${date}`}
              className="text-label text-primary hover:bg-primary-soft inline-flex min-h-11 items-center gap-1.5 rounded-full px-3"
            >
              <Plus aria-hidden className="size-4" /> Add without a photo
            </Link>
          </div>
          <Timeline date={date} today={today} meals={meals} />
        </section>
      </div>

      <AutoRefresh active={pending} />
      <TodayCapture />
    </DaySwipe>
  );
}
