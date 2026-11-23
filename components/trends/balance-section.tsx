"use client";

import Link from "next/link";
import { useState } from "react";

import { MealThumb, ScoreRing } from "@/components/balance/score-ring";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { HOW_IT_WORKS } from "@/lib/balance/score";
import type { BalanceListDto, BalanceMealDto, BalanceRankingsDto } from "@/lib/contracts/balance";
import { MEAL_SLOT_LABELS } from "@/lib/contracts/meals";
import { formatKcal, mealDay } from "@/lib/ui/format";

type Scope = "period" | "all";

const Row = ({ meal, today }: { meal: BalanceMealDto; today: string }) => (
  <li className="border-border border-t">
    <Link
      href={`/meals/${meal.mealId}`}
      className="hover:bg-surface-2 -mx-2 flex min-h-16 items-center gap-2.5 rounded-xl px-2 py-1.5"
    >
      <MealThumb photoUrl={meal.photoUrl} foods={meal.foods} />
      <span className="min-w-0 flex-1">
        <span className="text-body block font-semibold" dir="auto">
          {meal.title}
        </span>
        <span className="text-caption text-muted block">
          {mealDay(meal.localDate, today)} · {MEAL_SLOT_LABELS[meal.slot]} ·{" "}
          <span className="tabular">{formatKcal(meal.energy)}</span> kcal
        </span>
        <span className="text-caption block">{meal.reason}</span>
      </span>
      <ScoreRing score={meal.score} />
    </Link>
  </li>
);

const counts = (list: BalanceListDto) => {
  const judged = `${list.judged} ${list.judged === 1 ? "meal" : "meals"} judged`;
  return list.leftOut
    ? `${judged}; ${list.leftOut} left out (still being worked out, failed, or too few known nutrients).`
    : `${judged}.`;
};

/**
 * Trends "Most and least nutritious" (board 41): the three meals with the highest and the three
 * with the lowest balance score (lib/balance/score.ts), for the period shown or for all time. A
 * row opens the meal; "How it is worked out" explains the score in plain words.
 */
export const BalanceSection = ({
  balance,
  today,
  periodName,
}: {
  balance: BalanceRankingsDto;
  today: string;
  /** "this week", "this day": used in the empty message. */
  periodName: string;
}) => {
  const [scope, setScope] = useState<Scope>("period");
  const [how, setHow] = useState(false);
  const list = scope === "period" ? balance.period : balance.allTime;

  return (
    <Card
      as="section"
      aria-labelledby="balance-heading"
      className="flex flex-col gap-2.5 md:col-span-2"
      data-testid="trends-balance"
    >
      <h2 id="balance-heading" className="text-headline">
        Most and least nutritious
      </h2>
      <SegmentedControl
        label="Meals from"
        value={scope}
        onValueChange={setScope}
        options={[
          { value: "period", label: "This period" },
          { value: "all", label: "All time" },
        ]}
      />
      {list.judged === 0 ? (
        <p className="text-body text-muted py-2" data-testid="balance-empty">
          {scope === "period" ? `No meals to judge ${periodName} yet.` : "No meals to judge yet."}{" "}
          {list.leftOut
            ? `${list.leftOut} left out: still being worked out, failed, or too few known nutrients.`
            : "Log meals and Kal shows the most and least nutritious ones here."}
        </p>
      ) : (
        <>
          {/* Wide screens: the two lists side by side. */}
          <div className="flex flex-col gap-2.5 md:grid md:grid-cols-2 md:items-start md:gap-x-6">
            <div className="flex flex-col gap-2.5">
              <h3 id="balance-best" className="text-label text-primary mt-1">
                Most nutritious
              </h3>
              <ul aria-labelledby="balance-best" data-testid="balance-best">
                {list.best.map((meal) => (
                  <Row key={meal.mealId} meal={meal} today={today} />
                ))}
              </ul>
            </div>
            {list.worst.length > 0 && (
              <div className="flex flex-col gap-2.5">
                <h3 id="balance-worst" className="text-label text-danger mt-1">
                  Least nutritious
                </h3>
                <ul aria-labelledby="balance-worst" data-testid="balance-worst">
                  {list.worst.map((meal) => (
                    <Row key={meal.mealId} meal={meal} today={today} />
                  ))}
                </ul>
              </div>
            )}
          </div>
          <p className="text-caption text-muted" data-testid="balance-counts">
            {counts(list)}
          </p>
        </>
      )}
      <p className="text-caption text-muted">
        The balance score weighs nine nutrients to encourage and three to limit against your
        targets, for the meal&apos;s size, and how well the size fits that kind of meal.{" "}
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setHow(true)}
          className="text-primary inline-flex min-h-11 items-center font-semibold underline underline-offset-2"
        >
          How it is worked out
        </button>
      </p>
      <BottomSheet open={how} onOpenChange={setHow} title="How the balance score is worked out">
        <div className="text-body flex flex-col gap-3 pb-2">
          {HOW_IT_WORKS.map((paragraph) => (
            <p key={paragraph.slice(0, 24)}>{paragraph}</p>
          ))}
        </div>
      </BottomSheet>
    </Card>
  );
};
