"use client";

import { ArrowLeft, Check, CircleAlert, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/client/api";
import { PLAN_SLOTS, type PlanSuggestionDto } from "@/lib/contracts/integrations";
import { MEAL_SLOT_LABELS, type MealSlot } from "@/lib/contracts/meals";
import { shiftLocalDate } from "@/lib/meals/time";
import { formatKcal } from "@/lib/ui/format";

const DAYS_SHOWN = 14;

const dayLabel = (date: string, today: string) => {
  if (date === today) return "Today";
  if (date === shiftLocalDate(today, 1)) return "Tomorrow";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
};

const Chip = ({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) => (
  <button
    type="button"
    aria-pressed={pressed}
    onClick={onClick}
    className="aria-pressed:bg-primary aria-pressed:text-on-primary bg-surface-2 hover:bg-surface-3 text-label inline-flex min-h-11 items-center gap-1.5 rounded-full px-4"
  >
    {pressed && <Check aria-hidden className="size-4" />}
    {children}
  </button>
);

type Step = "pick" | "preview" | "confirm" | "done";

/**
 * Pick days and meals, see the suggested recipes per day against the targets, then confirm on a
 * screen that says the plan is shared with the household. Nothing reaches Mealie before that.
 */
export const PlanView = ({
  today,
  energyTarget,
  proteinTarget,
}: {
  today: string;
  energyTarget: number | null;
  proteinTarget: number | null;
}) => {
  const days = Array.from({ length: DAYS_SHOWN }, (_, i) => shiftLocalDate(today, i));
  const [chosenDays, setChosenDays] = useState<string[]>(days.slice(1, 4));
  const [slots, setSlots] = useState<MealSlot[]>(["dinner"]);
  const [step, setStep] = useState<Step>("pick");
  const [plan, setPlan] = useState<PlanSuggestionDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [written, setWritten] = useState<{ written: number; failed: number } | null>(null);

  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const entries = plan?.days.flatMap((d) => d.entries) ?? [];

  const suggest = async () => {
    setBusy(true);
    setError(null);
    try {
      setPlan(await api.suggestPlan({ days: [...chosenDays].sort(), slots }));
      setStep("preview");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      setWritten(
        await api.confirmPlan(
          entries.map((e) => ({ date: e.date, slot: e.slot, recipeId: e.recipeId })),
        ),
      );
      setStep("done");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 flex max-w-2xl flex-col gap-4">
      {step === "pick" && (
        <>
          <Card as="section" aria-labelledby="plan-days" className="flex flex-col gap-3">
            <h2 id="plan-days" className="text-headline">
              Days
            </h2>
            <div className="flex flex-wrap gap-2" role="group" aria-labelledby="plan-days">
              {days.map((day) => (
                <Chip
                  key={day}
                  pressed={chosenDays.includes(day)}
                  onClick={() => setChosenDays((list) => toggle(list, day))}
                >
                  {dayLabel(day, today)}
                </Chip>
              ))}
            </div>
          </Card>
          <Card as="section" aria-labelledby="plan-slots" className="flex flex-col gap-3">
            <h2 id="plan-slots" className="text-headline">
              Meals
            </h2>
            <div className="flex flex-wrap gap-2" role="group" aria-labelledby="plan-slots">
              {PLAN_SLOTS.map((slot) => (
                <Chip
                  key={slot}
                  pressed={slots.includes(slot)}
                  onClick={() => setSlots((list) => toggle(list, slot))}
                >
                  {MEAL_SLOT_LABELS[slot]}
                </Chip>
              ))}
            </div>
            <p className="text-caption text-muted">
              Kal picks recipes that keep each day within your energy target
              {energyTarget ? ` (${formatKcal(energyTarget)} kcal)` : ""} and reach your protein
              target{proteinTarget ? ` (${Math.round(proteinTarget)} g)` : ""}, shared out over the
              meals you choose. Only recipes with nutrition take part.
            </p>
          </Card>
          <Button
            size="lg"
            loading={busy}
            disabled={!chosenDays.length || !slots.length}
            onClick={() => void suggest()}
          >
            <Sparkles aria-hidden className="size-5" /> Suggest a plan
          </Button>
        </>
      )}

      {step === "preview" && plan && (
        <>
          <p className="text-caption text-muted">
            From {plan.recipesConsidered} recipes with nutrition. Nothing is in Mealie yet.
          </p>
          <ul className="flex flex-col gap-3" aria-label="Suggested plan">
            {plan.days.map((day) => (
              <li key={day.date}>
                <Card className="flex flex-col gap-2" data-testid="plan-day">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="text-headline">{dayLabel(day.date, today)}</h2>
                    <p
                      className={
                        day.meetsTargets
                          ? "text-caption bg-primary-soft text-on-primary-soft inline-flex items-center gap-1 rounded-full px-2.5 py-1"
                          : "text-caption bg-warning-soft text-on-warning-soft inline-flex items-center gap-1 rounded-full px-2.5 py-1"
                      }
                    >
                      {day.meetsTargets ? (
                        <Check aria-hidden className="size-4" />
                      ) : (
                        <CircleAlert aria-hidden className="size-4" />
                      )}
                      {day.meetsTargets ? "Within your targets" : "Misses your targets"}
                    </p>
                  </div>
                  {day.entries.length ? (
                    <ul className="flex flex-col gap-1">
                      {day.entries.map((entry) => (
                        <li key={entry.slot} className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0">
                            <span className="text-caption text-muted">
                              {MEAL_SLOT_LABELS[entry.slot]}:{" "}
                            </span>
                            <span className="text-label" dir="auto">
                              {entry.name}
                            </span>
                          </span>
                          <span className="text-caption text-muted tabular shrink-0">
                            {formatKcal(entry.kcal)} kcal · {Math.round(entry.protein)} g protein
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-caption text-muted">No recipe fits this day.</p>
                  )}
                  <p className="text-caption text-muted tabular">
                    {formatKcal(day.kcal)} of {formatKcal(day.energyBudget)} kcal,{" "}
                    {Math.round(day.protein)} g protein (at least {Math.round(day.proteinMin)} g)
                  </p>
                </Card>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setStep("pick")}>
              <ArrowLeft aria-hidden className="size-4" /> Change
            </Button>
            <Button disabled={!entries.length} onClick={() => setStep("confirm")}>
              Add to Mealie…
            </Button>
          </div>
        </>
      )}

      {step === "confirm" && (
        <Card
          as="section"
          aria-labelledby="plan-confirm"
          className="flex flex-col gap-3"
          role="region"
        >
          <h2 id="plan-confirm" className="text-headline inline-flex items-center gap-2">
            <Users aria-hidden className="size-5" /> Add to your household&apos;s plan?
          </h2>
          <p className="text-body">
            Meal plans in Mealie are shared with everyone in your household. Kal adds{" "}
            {entries.length} {entries.length === 1 ? "meal" : "meals"} to it; plans already there
            stay.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setStep("preview")}>
              <ArrowLeft aria-hidden className="size-4" /> Back
            </Button>
            <Button loading={busy} onClick={() => void confirm()}>
              Add {entries.length} {entries.length === 1 ? "meal" : "meals"} to Mealie
            </Button>
          </div>
        </Card>
      )}

      {step === "done" && written && (
        <Card className="flex flex-col items-start gap-3" role="status">
          <p className="text-body">
            Added {written.written} {written.written === 1 ? "meal" : "meals"} to Mealie.
            {written.failed > 0 && ` ${written.failed} could not be added.`}
          </p>
          <Button asChild variant="secondary">
            <Link href="/today">Back to Today</Link>
          </Button>
        </Card>
      )}

      {error && (
        <p role="alert" className="text-body text-danger">
          {error}
        </p>
      )}
    </div>
  );
};
