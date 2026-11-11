"use client";

import { ChevronLeft, ChevronRight, Lock, Pill } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { CM_PER_IN, HEALTH_LIMITS, KG_PER_LB, type HealthProfileDto } from "@/lib/contracts/body";
import type { Goal } from "@/lib/contracts/targets";

import type { Units } from "./format";

const RATES_KG = [0.25, 0.5, 0.75, 1];

const typed = (text: string) => {
  const value = Number(text.replace(",", ".").trim());
  return text.trim() && Number.isFinite(value) ? value : null;
};

const textarea =
  "border-border bg-surface text-body text-text focus:border-primary w-full resize-y rounded-[var(--radius-control)] border px-3.5 py-2.5 focus:outline-none focus-visible:outline-3 focus-visible:outline-[var(--focus)]";

/**
 * The private health profile (board 11, "Health profile"): height, year of birth and goal (the
 * same as in Settings), conditions, allergies and notes, the medicines list, and the switch that
 * lets meal analyses know the allergies and conditions (off).
 */
export const HealthView = ({
  initial,
  units,
  medicinesInUse,
}: {
  initial: HealthProfileDto;
  units: Units;
  medicinesInUse: number;
}) => {
  const router = useRouter();
  const { show } = useToast();
  const id = useId();
  const imperial = units === "imperial";
  const [height, setHeight] = useState(
    initial.heightCm
      ? String(Math.round((imperial ? initial.heightCm / CM_PER_IN : initial.heightCm) * 10) / 10)
      : "",
  );
  const [birthYear, setBirthYear] = useState(initial.birthYear ? String(initial.birthYear) : "");
  const [goal, setGoal] = useState<Goal | "">(initial.goal ?? "");
  const [rate, setRate] = useState(
    initial.goalRateKgPerWeek ? String(initial.goalRateKgPerWeek) : "0.5",
  );
  const [conditions, setConditions] = useState(initial.conditions);
  const [allergies, setAllergies] = useState(initial.allergies);
  const [notes, setNotes] = useState(initial.notes);
  const [useInAnalysis, setUseInAnalysis] = useState(initial.useInAnalysis);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const h = typed(height);
    const year = typed(birthYear);
    setBusy(true);
    setError(null);
    try {
      await api.saveHealthProfile({
        heightCm: h === null ? null : Math.round((imperial ? h * CM_PER_IN : h) * 10) / 10,
        birthYear: year,
        goal: goal || null,
        goalRateKgPerWeek: goal && goal !== "keep" ? Number(rate) : null,
        conditions,
        allergies,
        notes,
        useInAnalysis,
      });
      show({ title: "Health profile saved", tone: "success" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Not saved.");
    } finally {
      setBusy(false);
    }
  };

  const rateLabel = (kg: number) =>
    imperial
      ? `About ${Math.round((kg / KG_PER_LB) * 10) / 10} lb a week`
      : `About ${kg} kg a week`;

  return (
    <>
      <div className="flex items-center gap-2">
        <Link
          href="/body"
          aria-label="Back to Body"
          className="bg-surface-2 hover:bg-surface-3 grid size-11 shrink-0 place-items-center rounded-full"
        >
          <ChevronLeft aria-hidden className="size-5" />
        </Link>
        <h1 className="text-title min-w-0 flex-1">Health profile</h1>
      </div>
      <p className="text-caption text-muted mt-3 flex max-w-2xl items-start gap-2">
        <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
        Only you see this. Kal sends none of it anywhere unless you turn on &quot;Use in meal
        analysis&quot; below.
      </p>

      <div className="mt-4 grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
        <Card as="section" aria-labelledby={`${id}-basics`} className="flex flex-col gap-3">
          <h2 id={`${id}-basics`} className="text-headline">
            You and your goal
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            <Field
              label={imperial ? "Height, in" : "Height, cm"}
              inputMode="decimal"
              autoComplete="off"
              value={height}
              onChange={(event) => setHeight(event.target.value)}
            />
            <Field
              label="Year of birth"
              inputMode="numeric"
              autoComplete="off"
              value={birthYear}
              onChange={(event) => setBirthYear(event.target.value)}
            />
          </div>
          <SelectField
            label="Goal"
            options={[
              { value: "", label: "Not set" },
              { value: "lose", label: "Lose weight" },
              { value: "keep", label: "Keep my weight" },
              { value: "gain", label: "Gain weight" },
            ]}
            value={goal}
            onChange={(event) => setGoal(event.target.value as Goal | "")}
            hint="Body judges changes from it: waist down is better when you lose weight."
          />
          {(goal === "lose" || goal === "gain") && (
            <SelectField
              label="How fast"
              options={RATES_KG.map((kg) => ({ value: String(kg), label: rateLabel(kg) }))}
              value={rate}
              onChange={(event) => setRate(event.target.value)}
            />
          )}
          <p className="text-caption text-muted">
            The same as in Settings: your daily targets follow these too.
          </p>
        </Card>

        <Card as="section" aria-labelledby={`${id}-health`} className="flex flex-col gap-3">
          <h2 id={`${id}-health`} className="text-headline">
            Health
          </h2>
          {(
            [
              [
                "conditions",
                "Conditions",
                conditions,
                setConditions,
                "For example: type 2 diabetes, high blood pressure",
              ],
              [
                "allergies",
                "Allergies and intolerances",
                allergies,
                setAllergies,
                "For example: peanuts, lactose",
              ],
              ["notes", "Notes", notes, setNotes, "Anything else you want to keep here"],
            ] as const
          ).map(([key, label, value, setValue, hint]) => (
            <div key={key} className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-${key}`} className="text-label">
                {label}
              </label>
              <textarea
                id={`${id}-${key}`}
                dir="auto"
                rows={2}
                maxLength={HEALTH_LIMITS.textChars}
                value={value}
                aria-describedby={`${id}-${key}-hint`}
                onChange={(event) => setValue(event.target.value)}
                className={textarea}
              />
              <p id={`${id}-${key}-hint`} className="text-caption text-muted">
                {hint}
              </p>
            </div>
          ))}
          <Link
            href="/medicines"
            className="bg-surface-2 hover:bg-surface-3 text-label flex min-h-12 items-center gap-3 rounded-2xl px-4"
          >
            <Pill aria-hidden className="text-primary size-5" />
            <span className="flex-1">
              Medicines{" "}
              <span className="text-muted font-normal">
                · {medicinesInUse === 1 ? "1 in use" : `${medicinesInUse} in use`}
              </span>
            </span>
            <ChevronRight aria-hidden className="text-muted size-5" />
          </Link>
          <Switch
            label="Use in meal analysis"
            hint="Sends your allergies and conditions to your own AI provider with each meal, so it can name foods to watch. Off: they never leave Kal."
            checked={useInAnalysis}
            onChange={setUseInAnalysis}
          />
        </Card>
      </div>

      <div className="mt-4 flex max-w-4xl flex-col gap-2">
        {error && (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}
        <Button size="lg" className="rounded-full" loading={busy} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </>
  );
};
