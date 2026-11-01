"use client";

import { Pencil, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { saveProfileAction, setTargetAction } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SelectField } from "@/components/ui/select-field";
import { useToast } from "@/components/ui/toast";
import { formatNutrient, nutrientInfo, type NutrientCode } from "@/lib/contracts/nutrients";
import type { DailyTargets, Profile } from "@/lib/contracts/targets";
import { CM_PER_INCH, KG_PER_POUND, type Units } from "@/lib/ui/format";

const TARGET_CODES: NutrientCode[] = [
  "energy",
  "protein",
  "carbs",
  "fat",
  "fiber",
  "fat_sat",
  "sugars_added",
  "sodium",
];

const BASIS: Record<string, string> = {
  profile: "from your profile",
  dri: "recommended intake",
  default: "standard value",
  custom: "set by you",
};

const KIND: Record<string, string> = { goal: "about", min: "at least", max: "at most", range: "" };

const toText = (value: number | null, factor = 1, decimals = 0) =>
  value === null ? "" : String(Math.round((value / factor) * 10 ** decimals) / 10 ** decimals);

/** Profile (sex, age, height, weight, activity, goal) and the daily targets it gives. */
export const ProfileSection = ({
  profile,
  initialTargets,
  units,
}: {
  profile: Profile;
  initialTargets: DailyTargets;
  units: Units;
}) => {
  const router = useRouter();
  const { show } = useToast();
  const imperial = units === "imperial";
  const [sex, setSex] = useState<string>(profile.sex ?? "unset");
  const [birthYear, setBirthYear] = useState(toText(profile.birthYear));
  const [height, setHeight] = useState(toText(profile.heightCm, imperial ? CM_PER_INCH : 1));
  const [weight, setWeight] = useState(toText(profile.weightKg, imperial ? KG_PER_POUND : 1, 1));
  const [activity, setActivity] = useState<string>(profile.activityLevel ?? "");
  const [goal, setGoal] = useState<string>(profile.goal ?? "keep");
  const [rate, setRate] = useState(String(profile.goalRateKgPerWeek ?? 0.5));
  const [targets, setTargets] = useState(initialTargets);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<NutrientCode | null>(null);
  const [draft, setDraft] = useState("");

  const num = (text: string, factor = 1) => {
    const n = Number(text.replace(",", "."));
    return text.trim() && Number.isFinite(n) ? n * factor : null;
  };

  const save = async () => {
    setBusy(true);
    const result = await saveProfileAction({
      sex: sex === "unset" ? null : sex,
      birthYear: num(birthYear),
      heightCm: num(height, imperial ? CM_PER_INCH : 1),
      weightKg: num(weight, imperial ? KG_PER_POUND : 1),
      activityLevel: activity || null,
      goal,
      goalRateKgPerWeek: goal === "keep" ? null : num(rate),
    });
    setBusy(false);
    if (!result.ok) return show({ title: "Not saved", body: result.error, tone: "error" });
    setTargets(result.data);
    show({ title: "Profile saved", tone: "success" });
    router.refresh();
  };

  const saveTarget = async (code: NutrientCode, value: number | null) => {
    const result = await setTargetAction(code, value);
    if (!result.ok) return show({ title: "Not saved", body: result.error, tone: "error" });
    setTargets(result.data);
    setEditing(null);
    router.refresh();
  };

  return (
    <Card as="section" aria-labelledby="profile-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="profile-heading" className="text-headline">
          Profile and targets
        </h2>
        <p className="text-caption text-muted">
          Cal works out your daily targets from these. Every field is optional.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-label">Sex (for energy and nutrient needs)</span>
        <SegmentedControl
          label="Sex"
          value={sex}
          onValueChange={setSex}
          options={[
            { value: "female", label: "Female" },
            { value: "male", label: "Male" },
            { value: "unset", label: "Not set" },
          ]}
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field
          label="Birth year"
          inputMode="numeric"
          value={birthYear}
          onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
        />
        <Field
          label={imperial ? "Height (in)" : "Height (cm)"}
          inputMode="decimal"
          value={height}
          onChange={(e) => setHeight(e.target.value)}
        />
        <Field
          label={imperial ? "Weight (lb)" : "Weight (kg)"}
          inputMode="decimal"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
        />
      </div>
      <SelectField
        label="Activity"
        value={activity}
        onChange={(e) => setActivity(e.target.value)}
        options={[
          { value: "", label: "Not set" },
          { value: "sedentary", label: "Mostly sitting" },
          { value: "light", label: "Light (walks, 1 to 3 workouts a week)" },
          { value: "moderate", label: "Moderate (3 to 5 workouts a week)" },
          { value: "active", label: "Active (6 to 7 workouts a week)" },
          { value: "very_active", label: "Very active (physical job or training twice a day)" },
        ]}
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-label">Goal</span>
        <SegmentedControl
          label="Goal"
          value={goal}
          onValueChange={setGoal}
          options={[
            { value: "lose", label: "Lose" },
            { value: "keep", label: "Keep" },
            { value: "gain", label: "Gain" },
          ]}
        />
      </div>
      {goal !== "keep" && (
        <SelectField
          label="How fast"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          options={["0.25", "0.5", "0.75", "1"].map((v) => ({
            value: v,
            label: imperial
              ? `${(Number(v) / KG_PER_POUND).toFixed(1)} lb a week`
              : `${v} kg a week`,
          }))}
        />
      )}
      <Button onClick={() => void save()} loading={busy} className="self-start">
        Save profile
      </Button>

      <div className="border-border border-t pt-4">
        <h3 className="text-label">Daily targets</h3>
        <p className="text-caption text-muted mb-2">
          {targets.fromProfile
            ? "Calculated from your profile. Change any of them; your own values stay until you reset them."
            : "Standard values until the profile is filled in."}
        </p>
        <ul className="flex flex-col" data-testid="targets">
          {TARGET_CODES.map((code) => {
            const t = targets.targets[code];
            const info = nutrientInfo(code)!;
            return (
              <li
                key={code}
                className="border-border flex min-h-14 items-center gap-2 border-b last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-body">{info.name}</p>
                  <p className="text-caption text-muted">{t ? BASIS[t.basis] : "no target"}</p>
                </div>
                {editing === code ? (
                  <form
                    className="flex items-center gap-1.5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const value = num(draft);
                      if (value !== null) void saveTarget(code, value);
                    }}
                  >
                    <label htmlFor={`target-${code}`} className="sr-only">
                      {info.name} target in {info.unit}
                    </label>
                    <input
                      id={`target-${code}`}
                      autoFocus
                      inputMode="decimal"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      className="border-border bg-surface tabular text-body h-11 w-24 rounded-xl border px-2 text-right focus:outline-none focus-visible:outline-3 focus-visible:outline-[var(--focus)]"
                    />
                    <span className="text-caption text-muted w-8">{info.unit}</span>
                    <Button type="submit">Save</Button>
                  </form>
                ) : (
                  <>
                    <p className="tabular text-body text-right">
                      <span className="text-caption text-muted">{t ? KIND[t.kind] : ""} </span>
                      {t?.target ? formatNutrient(code, t.target) : "–"}
                    </p>
                    <button
                      type="button"
                      aria-label={`Change the ${info.name.toLowerCase()} target`}
                      onClick={() => {
                        setDraft(t?.target ? String(Math.round(t.target)) : "");
                        setEditing(code);
                      }}
                      className="text-muted hover:bg-surface-2 grid size-11 place-items-center rounded-full"
                    >
                      <Pencil aria-hidden className="size-4" />
                    </button>
                    {t?.custom && (
                      <button
                        type="button"
                        aria-label={`Reset the ${info.name.toLowerCase()} target`}
                        onClick={() => void saveTarget(code, null)}
                        className="text-muted hover:bg-surface-2 grid size-11 place-items-center rounded-full"
                      >
                        <RotateCcw aria-hidden className="size-4" />
                      </button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
};
