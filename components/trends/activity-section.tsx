"use client";

import Link from "next/link";

import { CATEGORY_COLOR } from "@/components/move/category-icon";
import { Card } from "@/components/ui/card";
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_LABELS,
  formatMinutes,
  formatSteps,
} from "@/lib/contracts/activities";
import { moveHref } from "@/lib/move/week";
import { averagesCaption, eatenBurnedText, whoText } from "@/lib/trends/activity";
import type { TrendsData } from "@/lib/trends/compute";
import { shortDate, weekdayLetter } from "@/lib/ui/format";

import { BarChart, StackedBarChart, type BarDatum, type StackDatum } from "./charts";

const Stat = ({ value, caption, testId }: { value: string; caption: string; testId: string }) => (
  <div className="min-w-0" data-testid={testId}>
    <p className="tabular text-xl leading-tight font-bold">{value}</p>
    <p className="text-caption text-muted">{caption}</p>
  </div>
);

/**
 * Trends "Activity" and "Eaten and burned" (board 37): steps, active minutes and workouts of the
 * period, steps per day against the goal, active minutes per day by category, the WHO week, and
 * the energy eaten next to the energy from activity. Days without activity data are left out of
 * the averages and say "–" in the tables.
 */
export const ActivitySection = ({ data, today }: { data: TrendsData; today: string }) => {
  const a = data.activity;
  const day = data.range === "day";
  const axisLabel = (date: string, i: number) =>
    data.range === "week"
      ? weekdayLetter(date)
      : i % 5 === 0 || i === a.days.length - 1
        ? shortDate(date).replace(/^\w+ /, "")
        : "";
  const title = (date: string) => `${weekdayLetter(date)}, ${shortDate(date)}`;
  const steps: BarDatum[] = a.days.map((d, i) => ({
    key: d.date,
    label: axisLabel(d.date, i),
    title: title(d.date),
    value: d.steps,
  }));
  const used = ACTIVITY_CATEGORIES.filter((c) => a.minutes[c] > 0);
  const minutes: StackDatum[] = a.days.map((d, i) => ({
    key: d.date,
    label: axisLabel(d.date, i),
    title: title(d.date),
    values: d.activeMinutes === null ? null : d.minutes,
  }));
  const caption = averagesCaption(a);
  const energyTarget = data.targets.energy?.target ?? null;

  return (
    <>
      <Card
        as="section"
        aria-labelledby="trends-activity-heading"
        className="flex flex-col gap-3 md:col-span-2"
        data-testid="trends-activity"
      >
        <h2 id="trends-activity-heading" className="text-headline">
          Activity
        </h2>
        {a.loggedDays === 0 ? (
          <p className="text-body text-muted">
            No steps or workouts {day ? "on this day" : "in this period"}. Kal for Android sends
            steps from Health Connect, and Move takes activities you add.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat
                testId="trends-steps"
                value={a.averageSteps === null ? "–" : formatSteps(a.averageSteps)}
                caption={day ? "steps" : "steps a day"}
              />
              <Stat
                testId="trends-active"
                value={a.averageMinutes === null ? "–" : formatMinutes(a.averageMinutes)}
                caption={day ? "active" : "active a day"}
              />
              <Stat
                testId="trends-workouts"
                value={a.workouts.toLocaleString("en-US")}
                caption={a.workouts === 1 ? "workout" : "workouts"}
              />
            </div>
            {caption && <p className="text-caption text-muted">{caption}</p>}
            {day ? (
              <p className="text-body" data-testid="trends-categories">
                {used.length
                  ? used
                      .map((c) => `${ACTIVITY_CATEGORY_LABELS[c]} ${formatMinutes(a.minutes[c])}`)
                      .join(" · ")
                  : "Steps only, no timed activity."}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <h3 className="text-label mb-1">Steps per day</h3>
                  <BarChart
                    data={steps}
                    unit="steps"
                    color="protein"
                    goalColor="primary"
                    target={a.stepGoal}
                    targetLabel="Goal"
                    label="Steps per day"
                    height={160}
                  />
                </div>
                <div>
                  <h3 className="text-label mb-1">Active minutes per day</h3>
                  <StackedBarChart
                    data={minutes}
                    series={used.map((c) => ({
                      key: c,
                      label: ACTIVITY_CATEGORY_LABELS[c],
                      fill: CATEGORY_COLOR[c].fill,
                      swatch: CATEGORY_COLOR[c].bar,
                    }))}
                    unit="min"
                    label="Active minutes per day"
                  />
                </div>
              </div>
            )}
          </>
        )}
        {a.who && (a.loggedDays > 0 || day) && (
          <p className="text-caption text-muted" data-testid="trends-who">
            {whoText(a.who)}
          </p>
        )}
        {day && (
          <Link
            href={moveHref(data.end, today)}
            className="text-label text-primary -ml-2 inline-flex min-h-11 items-center self-start rounded-full px-2"
          >
            Open this day in Move
          </Link>
        )}
      </Card>

      <Card
        as="section"
        aria-labelledby="trends-burned-heading"
        className="flex flex-col gap-2"
        data-testid="trends-eaten-burned"
      >
        <h2 id="trends-burned-heading" className="text-headline">
          Eaten and burned
        </h2>
        <p className="text-body">
          {eatenBurnedText({
            range: data.range,
            eaten: data.loggedDays ? (data.average.energy ?? 0) : null,
            burned: a.averageEnergy,
            target: energyTarget,
          })}
        </p>
        <p className="text-caption text-muted">
          Energy from activity is what your activities say they burned, most of it an estimate from
          your weight; {day ? "" : "each average counts only the days that have it; "}the target
          does not include it.
        </p>
      </Card>
    </>
  );
};
