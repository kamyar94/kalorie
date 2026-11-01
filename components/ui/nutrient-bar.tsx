import { cn } from "./cn";
import type { NutrientColor } from "./nutrient-ring";

const FILLS: Record<NutrientColor, string> = {
  energy: "bg-energy",
  protein: "bg-protein",
  carbs: "bg-carbs",
  fat: "bg-fat",
  fiber: "bg-fiber",
  primary: "bg-primary",
};

const format = (value: number, decimals: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: decimals });

export type NutrientBarProps = {
  label: string;
  value: number;
  target: number | null;
  unit: string;
  color?: NutrientColor;
  /** "max": the target is a ceiling (sodium); going past it is shown as a warning. */
  kind?: "goal" | "min" | "max" | "range";
  decimals?: number;
  /** Label above the numbers, for narrow columns (three bars side by side on a phone). */
  stacked?: boolean;
  className?: string;
};

/** A labelled bar: amount and target as text, progress as a filled track. */
export const NutrientBar = ({
  label,
  value,
  target,
  unit,
  color = "primary",
  kind = "goal",
  decimals = 0,
  stacked,
  className,
}: NutrientBarProps) => {
  const share = target && target > 0 ? Math.min(1, value / target) : 0;
  const overCeiling = kind === "max" && !!target && value > target;
  return (
    <div className={cn("min-w-0", className)}>
      <div className={cn("flex gap-x-2", stacked ? "flex-col" : "items-baseline justify-between")}>
        <span className="text-label truncate">{label}</span>
        <span className="tabular text-caption text-muted shrink-0 truncate">
          <span className={cn("text-label text-text", overCeiling && "text-danger")}>
            {format(value, decimals)}
          </span>
          {target ? ` / ${format(target, decimals)}` : ""} {unit}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={target ?? undefined}
        aria-valuenow={Math.round(value * 10) / 10}
        aria-valuetext={`${format(value, decimals)}${target ? ` of ${format(target, decimals)}` : ""} ${unit}`}
        className="bg-surface-3 mt-1.5 h-2 overflow-hidden rounded-full"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            overCeiling ? "bg-danger" : FILLS[color],
          )}
          style={{ width: `${share * 100}%` }}
        />
      </div>
    </div>
  );
};
