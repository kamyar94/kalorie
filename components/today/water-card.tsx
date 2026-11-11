"use client";

import { Droplet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { formatMinutes } from "@/lib/contracts/activities";
import { goalLitres, litres } from "@/lib/meals/hydration";
import { deviceTimeZone } from "@/lib/photos/client";
import { fromLocalInputValue } from "@/lib/ui/format";

const QUICK = [
  { ml: 250, label: "+ Glass, 250 ml" },
  { ml: 500, label: "+ Bottle, 500 ml" },
] as const;

/**
 * The day's water from drinks against the goal, with two buttons that log a glass or a bottle of
 * water at once (a meal with one item, Water, kind drink, no energy). On an earlier day the water
 * is logged at 12:00 of that day. Timed activity raises the day's goal (lib/move/water.ts); the
 * caption then says how the goal is made up.
 */
export const WaterCard = ({
  date,
  today,
  totalMl,
  baseMl,
  activityMl = 0,
  activityMinutes = 0,
}: {
  date: string;
  today: string;
  totalMl: number;
  /** The hydration target. */
  baseMl: number;
  /** The estimate for the day's activity, and the minutes it is for. */
  activityMl?: number;
  activityMinutes?: number;
}) => {
  const goalMl = baseMl + activityMl;
  const router = useRouter();
  const { show } = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const percent = goalMl > 0 ? Math.min(100, (totalMl / goalMl) * 100) : 0;

  const log = async (ml: number) => {
    const tz = deviceTimeZone();
    const eatenAt =
      date === today ? new Date().toISOString() : fromLocalInputValue(`${date}T12:00`, tz);
    if (!eatenAt) return;
    setBusy(ml);
    try {
      const meal = await api.createManualMeal({
        eatenAt,
        tz,
        title: "Water",
        items: [
          { name: "Water", kind: "drink", ml, grams: ml, nutrients: { energy: 0, water: ml } },
        ],
      });
      router.refresh();
      show({
        title: `${ml} ml of water logged`,
        tone: "success",
        action: {
          label: "Undo",
          onClick: () =>
            void api
              .deleteMeal(meal.id)
              .then(() => router.refresh())
              .catch((error) =>
                show({ title: "Not undone", body: (error as Error).message, tone: "error" }),
              ),
        },
      });
    } catch (error) {
      show({ title: "Water not logged", body: (error as Error).message, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

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
      <div className="flex gap-2">
        {QUICK.map((option) => (
          <button
            key={option.ml}
            type="button"
            disabled={busy !== null}
            aria-busy={busy === option.ml || undefined}
            onClick={() => void log(option.ml)}
            className="text-label bg-surface-2 hover:bg-surface-3 min-h-11 flex-1 rounded-full px-2 disabled:opacity-60"
          >
            {option.label}
          </button>
        ))}
      </div>
    </Card>
  );
};
