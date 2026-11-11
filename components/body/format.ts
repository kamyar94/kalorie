// How Body shows values and changes: in the person's units (lb and in for imperial), with
// better / steady / worse in words and colour (the words always carry the meaning).
import { formatChange, formatMeasure, toDisplay, type Verdict } from "@/lib/contracts/body";
import type { Goal } from "@/lib/contracts/targets";

export type Units = "metric" | "imperial";

/** "113.6 kg", "250.4 lb", "31.2 %", "14", "0.65". */
export const showValue = (value: number, unit: string, decimals: number, units: Units) => {
  const shown = toDisplay(value, unit, units);
  const number = formatMeasure(shown.value, decimals);
  return shown.unit ? `${number} ${shown.unit}` : number;
};

/** "−3", "+0.5" in the person's units (no unit: the column says it). */
export const showChange = (change: number, unit: string, decimals: number, units: Units) =>
  formatChange(toDisplay(change, unit, units).value, decimals);

export const VERDICT_CLASS: Record<Verdict, string> = {
  better: "text-primary font-semibold",
  worse: "text-danger font-semibold",
  steady: "text-muted",
  changed: "text-muted",
};

/** "Goal: lose about 0.5 kg a week". */
export const goalLine = (goal: Goal | null, rate: number | null, units: Units) => {
  if (!goal) return "No goal yet: set it in your health profile.";
  if (goal === "keep") return "Goal: keep your weight";
  const verb = goal === "lose" ? "lose" : "gain";
  return rate
    ? `Goal: ${verb} about ${showValue(rate, "kg", 2, units)} a week`
    : `Goal: ${verb} weight`;
};
