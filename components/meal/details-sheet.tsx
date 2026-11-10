"use client";

import { useId, useState } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  MEAL_SLOT_LABELS,
  MEAL_SLOTS,
  type MealDto,
  type MealPatch,
  type MealSlot,
} from "@/lib/contracts/meals";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/ui/format";

/** Edits a meal's name, time and slot (moving the time moves the meal to its day). */
export const DetailsSheet = ({
  meal,
  open,
  onOpenChange,
  onSave,
}: {
  meal: MealDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (patch: MealPatch) => Promise<boolean>;
}) => {
  const [title, setTitle] = useState(meal.title ?? "");
  const [when, setWhen] = useState(toLocalInputValue(meal.eatenAt, meal.tz));
  const [slot, setSlot] = useState<MealSlot>(meal.slot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTitle(meal.title ?? "");
      setWhen(toLocalInputValue(meal.eatenAt, meal.tz));
      setSlot(meal.slot);
      setError(null);
    }
  }

  const save = async () => {
    const patch: MealPatch = {};
    if ((meal.title ?? "") !== title.trim()) patch.title = title.trim() || null;
    if (when !== toLocalInputValue(meal.eatenAt, meal.tz)) {
      const iso = fromLocalInputValue(when, meal.tz);
      if (!iso) return setError("Pick a valid day and time.");
      if (new Date(iso).getTime() > Date.now() + 5 * 60_000)
        return setError("The time cannot be in the future.");
      patch.eatenAt = iso;
    }
    // A slot picked here stays; otherwise a new time names the meal again.
    if (slot !== meal.slot) patch.slot = slot;
    if (!Object.keys(patch).length) return onOpenChange(false);
    setBusy(true);
    try {
      if (await onSave(patch)) onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Meal details"
      description={`Time zone: ${meal.tz}`}
      footer={
        <Button fullWidth size="lg" loading={busy} onClick={() => void save()}>
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-4 py-1">
        <Field
          label="Name"
          dir="auto"
          maxLength={120}
          value={title}
          placeholder={MEAL_SLOT_LABELS[meal.slot]}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Field
          label="Day and time"
          type="datetime-local"
          value={when}
          max={toLocalInputValue(new Date().toISOString(), meal.tz)}
          onChange={(event) => setWhen(event.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <span id={`${id}-slot`} className="text-label">
            Meal
          </span>
          <SegmentedControl
            label="Meal"
            value={slot}
            onValueChange={setSlot}
            options={MEAL_SLOTS.map((s) => ({ value: s, label: MEAL_SLOT_LABELS[s] }))}
            className="grid-flow-row grid-cols-3"
          />
          <p className="text-caption text-muted">
            {meal.slotLocked
              ? "Chosen by you: Cal keeps this name."
              : "Cal names the meal from its food and time until you pick one."}
          </p>
        </div>
        {error && (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}
      </div>
    </BottomSheet>
  );
};
