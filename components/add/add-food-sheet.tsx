"use client";

import { useId, useState } from "react";

import { MacroSummary } from "@/components/meal/macro-summary";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Field } from "@/components/ui/field";
import { Stepper } from "@/components/ui/stepper";
import type { FoodResult } from "@/lib/contracts/food-search";
import type { ItemInput, ItemKind } from "@/lib/contracts/meals";
import { nutrientsForAmount } from "@/lib/contracts/nutrients";
import { deviceTimeZone } from "@/lib/photos/client";
import { formatKcal, fromLocalInputValue, toLocalInputValue, type Units } from "@/lib/ui/format";

const KIND: Record<FoodResult["kind"], ItemKind> = {
  food: "ingredient",
  dish: "dish",
  recipe: "dish",
  packaged: "packaged",
};

export type PickedFood = { food: FoodResult; grams?: number; portionText?: string | null };

/** The default moment for a new meal: now, or the same clock time on an earlier day. */
const defaultWhen = (date: string | null, tz: string) => {
  const now = toLocalInputValue(new Date().toISOString(), tz);
  return date && date < now.slice(0, 10) ? `${date}T${now.slice(11)}` : now;
};

/**
 * How much of a picked food: grams (or a portion button), how many, and for a new meal its time.
 * Shows the calories and macros for the amount before adding.
 */
export const AddFoodSheet = ({
  picked,
  toMeal,
  date,
  units,
  onClose,
  onAdd,
}: {
  picked: PickedFood | null;
  /** Adding to an existing meal (no time to choose). */
  toMeal: boolean;
  /** The day a new meal goes to (null: today). */
  date: string | null;
  units: Units;
  onClose: () => void;
  onAdd: (item: ItemInput, when: { eatenAt: string; tz: string } | null) => Promise<void>;
}) => {
  const food = picked?.food ?? null;
  const [grams, setGrams] = useState("100");
  const [portion, setPortion] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [tz, setTz] = useState("UTC");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  // A newly picked food starts from its usual amount (state adjusted during render, see
  // https://react.dev/learn/you-might-not-need-an-effect).
  const [shownFor, setShownFor] = useState<PickedFood | null>(null);
  if (picked !== shownFor) {
    setShownFor(picked);
    if (picked) {
      const start =
        picked.grams ?? picked.food.servingGrams ?? picked.food.portions[0]?.grams ?? 100;
      setGrams(String(Math.round(start)));
      setPortion(
        picked.portionText ??
          (picked.grams
            ? null
            : picked.food.servingGrams
              ? null
              : (picked.food.portions[0]?.label ?? null)),
      );
      setCount(1);
      const zone = deviceTimeZone();
      setTz(zone);
      setWhen(defaultWhen(date, zone));
      setError(null);
    }
  }

  const amount = Number(grams.replace(",", "."));
  const valid = Number.isFinite(amount) && amount > 0 && amount <= 5000;
  const nutrients = food && valid ? nutrientsForAmount(food.per100g, { grams: amount, count }) : {};

  const add = async () => {
    if (!food || !valid) return setError("Give the amount in grams.");
    let at: { eatenAt: string; tz: string } | null = null;
    if (!toMeal) {
      const iso = fromLocalInputValue(when, tz);
      if (!iso) return setError("Pick a valid day and time.");
      if (new Date(iso).getTime() > Date.now() + 5 * 60_000)
        return setError("The time cannot be in the future.");
      at = { eatenAt: iso, tz };
    }
    setBusy(true);
    setError(null);
    try {
      await onAdd(
        {
          name: food.nameEn,
          localName: food.nameFa,
          kind: KIND[food.kind],
          foodId: food.id,
          grams: amount,
          count,
          portionText: portion,
        },
        at,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "The food was not added.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={!!picked}
      onOpenChange={(open) => !open && onClose()}
      title={food?.nameEn ?? "Add"}
      description={
        [food?.brand, food?.nameFa].filter(Boolean).join(" · ") || food?.sourceNote || undefined
      }
      footer={
        <Button fullWidth size="lg" loading={busy} disabled={!valid} onClick={() => void add()}>
          {toMeal ? "Add to the meal" : "Log it"} · {formatKcal(nutrients.energy)} kcal
        </Button>
      }
    >
      {food && (
        <div className="flex flex-col gap-4 py-1">
          <MacroSummary nutrients={nutrients} />
          {food.portions.length > 0 && (
            <ul aria-label="Portions" className="flex flex-wrap gap-2">
              {food.portions.slice(0, 8).map((p) => {
                const active = portion === p.label;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setPortion(p.label);
                        setGrams(String(Math.round(p.grams)));
                      }}
                      className={cn(
                        "text-label min-h-11 rounded-full border px-3.5",
                        active
                          ? "bg-primary-soft text-on-primary-soft border-transparent"
                          : "border-border hover:bg-surface-2",
                      )}
                    >
                      <span dir="auto">{p.label}</span>{" "}
                      <span className="text-caption text-muted">{Math.round(p.grams)} g</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
            <Field
              label={units === "imperial" ? "Grams (1 oz = 28 g)" : "Grams"}
              inputMode="decimal"
              value={grams}
              onChange={(event) => {
                setGrams(event.target.value.replace(/[^\d.,]/g, ""));
                setPortion(null);
              }}
            />
            <div className="flex flex-col gap-1.5">
              <span id={`${id}-count`} className="text-label">
                How many
              </span>
              <Stepper
                label="How many"
                value={count}
                onChange={setCount}
                min={0.5}
                max={20}
                step={0.5}
                format={(v) => `${v}×`}
              />
            </div>
          </div>
          {!toMeal && (
            <Field
              label="When"
              type="datetime-local"
              value={when}
              max={toLocalInputValue(new Date().toISOString(), tz)}
              onChange={(event) => setWhen(event.target.value)}
            />
          )}
          <p className="text-caption text-muted">
            {formatKcal(food.per100g.energy)} kcal per 100 g
            {food.sourceNote ? ` · ${food.sourceNote}` : ""}
          </p>
          {error && (
            <p role="alert" className="text-body text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </BottomSheet>
  );
};
