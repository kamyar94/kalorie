"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";

import { savePreferencesAction } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SelectField } from "@/components/ui/select-field";
import { useToast } from "@/components/ui/toast";
import { MEAL_SLOT_LABELS } from "@/lib/contracts/meals";
import type { MealWindows } from "@/lib/meals/time";
import { useDeviceTimeZone } from "@/lib/ui/hooks";

const CUISINE_SUGGESTIONS = [
  "Persian home cooking",
  "Mediterranean",
  "Middle Eastern",
  "Turkish",
  "Indian",
  "East Asian",
  "Italian",
  "Mexican",
  "Vegetarian",
];

export type PreferencesDto = {
  timeZone: string;
  units: "metric" | "imperial";
  mealWindows: MealWindows;
  cuisines: string[];
};

/** Units, time zone, cuisines and meal windows: how Kal files and shows meals. */
export const PreferencesSection = ({ initial }: { initial: PreferencesDto }) => {
  const router = useRouter();
  const { show } = useToast();
  const [units, setUnits] = useState(initial.units);
  const [timeZone, setTimeZone] = useState(initial.timeZone);
  const [windows, setWindows] = useState(initial.mealWindows);
  const [cuisines, setCuisines] = useState(initial.cuisines);
  const [cuisine, setCuisine] = useState("");
  const device = useDeviceTimeZone();
  const [busy, setBusy] = useState<string | null>(null);
  const id = useId();

  // Every zone the browser knows, once on the device (the server renders the saved one only).
  const zoneOptions = useMemo(() => {
    let all: string[] = [];
    if (device)
      try {
        all =
          (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.(
            "timeZone",
          ) ?? [];
      } catch {
        all = [];
      }
    const zones = Array.from(new Set([initial.timeZone, timeZone, device ?? "UTC", "UTC", ...all]));
    return zones.sort().map((z) => ({ value: z, label: z.replace(/_/g, " ") }));
  }, [device, initial.timeZone, timeZone]);

  const save = async (key: string, input: Parameters<typeof savePreferencesAction>[0]) => {
    setBusy(key);
    const result = await savePreferencesAction(input);
    setBusy(null);
    if (!result.ok) {
      show({ title: "Not saved", body: result.error, tone: "error" });
      return false;
    }
    show({ title: "Saved", tone: "success" });
    router.refresh();
    return true;
  };

  const addCuisine = (text: string) => {
    const clean = text.trim();
    if (!clean || cuisines.some((c) => c.toLowerCase() === clean.toLowerCase())) return;
    const next = [...cuisines, clean];
    setCuisines(next);
    setCuisine("");
    void save("cuisines", { cuisines: next }).then((ok) => !ok && setCuisines(cuisines));
  };

  const removeCuisine = (text: string) => {
    const next = cuisines.filter((c) => c !== text);
    setCuisines(next);
    void save("cuisines", { cuisines: next }).then((ok) => !ok && setCuisines(cuisines));
  };

  return (
    <Card as="section" aria-labelledby="prefs-heading" className="flex flex-col gap-5">
      <h2 id="prefs-heading" className="text-headline">
        Units, time and food
      </h2>

      <div className="flex flex-col gap-1.5">
        <span className="text-label">Units</span>
        <SegmentedControl
          label="Units"
          value={units}
          onValueChange={(next) => {
            setUnits(next);
            void save("units", { units: next });
          }}
          options={[
            { value: "metric", label: "Metric (g, kg, cm)" },
            { value: "imperial", label: "Imperial (oz, lb, in)" },
          ]}
        />
      </div>

      <div className="flex flex-col gap-2">
        <SelectField
          label="Home time zone"
          hint="Meals use the time zone of the device that took them; this one is used when none is known."
          value={timeZone}
          onChange={(e) => {
            setTimeZone(e.target.value);
            void save("tz", { timeZone: e.target.value });
          }}
          options={zoneOptions}
        />
        {device && device !== timeZone && (
          <Button
            variant="ghost"
            className="text-primary self-start"
            onClick={() => {
              setTimeZone(device);
              void save("tz", { timeZone: device });
            }}
          >
            Use this device&apos;s time zone ({device.replace(/_/g, " ")})
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-label" id={`${id}-cuisines`}>
          Cuisines you usually eat
        </h3>
        <p className="text-caption text-muted">Helps Kal recognise home cooking in your photos.</p>
        {cuisines.length > 0 && (
          <ul aria-labelledby={`${id}-cuisines`} className="flex flex-wrap gap-2">
            {cuisines.map((c) => (
              <li key={c}>
                <button
                  type="button"
                  onClick={() => removeCuisine(c)}
                  aria-label={`Remove ${c}`}
                  className="bg-primary-soft text-on-primary-soft text-label inline-flex min-h-11 items-center gap-1.5 rounded-full pr-3 pl-4"
                >
                  <span dir="auto">{c}</span> <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            addCuisine(cuisine);
          }}
        >
          <label htmlFor={`${id}-cuisine`} className="sr-only">
            Add a cuisine
          </label>
          <input
            id={`${id}-cuisine`}
            list={`${id}-cuisine-list`}
            dir="auto"
            maxLength={40}
            value={cuisine}
            onChange={(e) => setCuisine(e.target.value)}
            placeholder="Add a cuisine"
            className="border-border bg-surface text-body placeholder:text-muted focus:border-primary min-h-11 min-w-0 flex-1 rounded-xl border px-3 focus:outline-none focus-visible:outline-3 focus-visible:outline-[var(--focus)]"
          />
          <datalist id={`${id}-cuisine-list`}>
            {CUISINE_SUGGESTIONS.filter((s) => !cuisines.includes(s)).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <Button
            type="submit"
            variant="secondary"
            disabled={!cuisine.trim() || busy === "cuisines"}
          >
            <Plus aria-hidden className="size-4" /> Add
          </Button>
        </form>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-label">Meal windows</h3>
        <p className="text-caption text-muted">
          A meal is filed by the time of its first photo; other times count as a snack.
        </p>
        {(["breakfast", "lunch", "dinner"] as const).map((slot) => (
          <fieldset
            key={slot}
            className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2"
          >
            <legend className="sr-only">{MEAL_SLOT_LABELS[slot]}</legend>
            <span aria-hidden className="text-body">
              {MEAL_SLOT_LABELS[slot]}
            </span>
            {[0, 1].map((end) => (
              <label key={end} className="flex min-w-0 flex-col">
                <span className="sr-only">
                  {MEAL_SLOT_LABELS[slot]} {end ? "ends" : "starts"}
                </span>
                <input
                  type="time"
                  value={windows[slot][end]}
                  onChange={(e) =>
                    setWindows((w) => {
                      const pair: [string, string] = [...w[slot]];
                      pair[end] = e.target.value;
                      return { ...w, [slot]: pair };
                    })
                  }
                  className="border-border bg-surface tabular text-body min-h-11 w-full min-w-0 rounded-xl border px-2 focus:outline-none focus-visible:outline-3 focus-visible:outline-[var(--focus)]"
                />
              </label>
            ))}
          </fieldset>
        ))}
        <Button
          variant="secondary"
          className="self-start"
          loading={busy === "windows"}
          onClick={() => void save("windows", { mealWindows: windows })}
        >
          Save meal windows
        </Button>
      </div>
    </Card>
  );
};
