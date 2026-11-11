"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { api } from "@/lib/client/api";
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_LABELS,
  ACTIVITY_LIMITS,
  ACTIVITY_TYPES,
  activityType,
  energyEstimate,
  INTENSITIES,
  INTENSITY_LABELS,
  metOf,
  type ActivityDto,
  type Intensity,
} from "@/lib/contracts/activities";
import { deviceTimeZone } from "@/lib/photos/client";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/ui/format";

const DEFAULT_TYPE = "walk";
const DEFAULT_MINUTES = 30;

/** A positive number typed with a comma or a point, else null. */
const typed = (text: string) => {
  const value = Number(text.replace(",", ".").trim());
  return text.trim() && Number.isFinite(value) && value > 0 ? value : null;
};

/**
 * "+ Activity" (board 10): what was done (types grouped by category), when it started, how long
 * and how hard, and the distance where it matters; a day's steps instead for "Steps". The energy
 * is shown as an estimate from the person's weight.
 */
export const ActivitySheet = ({
  openedAt,
  onOpenChange,
  weightKg,
  onSaved,
}: {
  /** When the sheet was opened (Date.now() of the press), null while closed. */
  openedAt: number | null;
  onOpenChange: (open: boolean) => void;
  /** The latest known weight, for the estimate (null: no estimate). */
  weightKg: number | null;
  onSaved: (activity: ActivityDto) => void;
}) => {
  const id = useId();
  const [typeId, setTypeId] = useState(DEFAULT_TYPE);
  const [minutes, setMinutes] = useState(String(DEFAULT_MINUTES));
  const [intensity, setIntensity] = useState<Intensity>("moderate");
  const [startedAt, setStartedAt] = useState("");
  const [distance, setDistance] = useState("");
  const [steps, setSteps] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each opening starts afresh: a walk of 30 minutes that ended just now.
  const open = openedAt !== null;
  const [shownAt, setShownAt] = useState<number | null>(null);
  if (openedAt !== shownAt) {
    setShownAt(openedAt);
    if (openedAt !== null) {
      setTypeId(DEFAULT_TYPE);
      setMinutes(String(DEFAULT_MINUTES));
      setIntensity(activityType(DEFAULT_TYPE)!.intensity);
      setStartedAt(
        toLocalInputValue(
          new Date(openedAt - DEFAULT_MINUTES * 60_000).toISOString(),
          deviceTimeZone(),
        ),
      );
      setDistance("");
      setSteps("");
      setTitle("");
      setError(null);
    }
  }

  const type = activityType(typeId) ?? activityType(DEFAULT_TYPE)!;
  const duration = typed(minutes);
  const estimate = type.steps
    ? null
    : energyEstimate(metOf(type.category, intensity), weightKg, duration);

  const save = async () => {
    const tz = deviceTimeZone();
    const at = fromLocalInputValue(startedAt, tz);
    if (!at) return setError("Choose when it started.");
    if (type.steps && !typed(steps)) return setError("Write how many steps.");
    if (!type.steps && !duration) return setError("Write how long it took, in minutes.");
    setBusy(true);
    setError(null);
    try {
      const saved = await api.createActivity({
        type: type.id,
        title: title.trim() || null,
        startedAt: at,
        tz,
        ...(type.steps
          ? { steps: Math.round(typed(steps)!) }
          : {
              durationMin: Math.round(duration!),
              intensity,
              distanceKm: type.distance ? typed(distance) : null,
            }),
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Not saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add an activity"
      description="Workouts from openGym and imported files come in by themselves."
      footer={
        <Button size="lg" fullWidth loading={busy} onClick={() => void save()}>
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-3.5 py-1">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-type`} className="text-label">
            What did you do?
          </label>
          <div className="relative">
            <select
              id={`${id}-type`}
              value={type.id}
              onChange={(event) => {
                const next = activityType(event.target.value);
                if (!next) return;
                setTypeId(next.id);
                setIntensity(next.intensity);
              }}
              className="border-border bg-surface text-body text-text focus:border-primary min-h-12 w-full appearance-none rounded-[var(--radius-control)] border pr-10 pl-3.5 focus:outline-none focus-visible:outline-3 focus-visible:outline-offset-0 focus-visible:outline-[var(--focus)]"
            >
              {ACTIVITY_CATEGORIES.map((category) => (
                <optgroup key={category} label={ACTIVITY_CATEGORY_LABELS[category]}>
                  {ACTIVITY_TYPES.filter((t) => t.category === category).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="text-muted pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2"
            />
          </div>
        </div>

        <Field
          label={type.steps ? "Day" : "Started at"}
          type="datetime-local"
          value={startedAt}
          onChange={(event) => setStartedAt(event.target.value)}
        />

        {type.steps ? (
          <Field
            label="Steps"
            inputMode="numeric"
            autoComplete="off"
            value={steps}
            onChange={(event) => setSteps(event.target.value)}
            hint="The day's total from your phone or watch."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <Field
                label="Minutes"
                inputMode="numeric"
                autoComplete="off"
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
              />
              {type.distance && (
                <Field
                  label="Distance, km"
                  inputMode="decimal"
                  autoComplete="off"
                  value={distance}
                  onChange={(event) => setDistance(event.target.value)}
                />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <span aria-hidden className="text-label">
                How hard was it?
              </span>
              <SegmentedControl
                label="How hard was it?"
                value={intensity}
                onValueChange={setIntensity}
                options={INTENSITIES.map((value) => ({ value, label: INTENSITY_LABELS[value] }))}
              />
              <p className="text-caption text-muted">
                Moderate: you can talk but not sing. Vigorous: only a few words at a time.
              </p>
            </div>
          </>
        )}

        <Field
          label="Name (optional)"
          placeholder={type.label}
          autoComplete="off"
          maxLength={ACTIVITY_LIMITS.titleChars}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />

        {!type.steps && (
          <p className="text-caption text-muted" data-testid="activity-estimate">
            {estimate !== null
              ? `About ${estimate.toLocaleString("en-US")} kcal (an estimate from your weight).`
              : "Add your weight in Settings or on Body for an energy estimate."}
          </p>
        )}
        {error && (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}
      </div>
    </BottomSheet>
  );
};
