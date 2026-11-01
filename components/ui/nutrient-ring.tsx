import { cn } from "./cn";

export type NutrientColor = "energy" | "protein" | "carbs" | "fat" | "fiber" | "primary";

const STROKES: Record<NutrientColor, string> = {
  energy: "stroke-energy",
  protein: "stroke-protein",
  carbs: "stroke-carbs",
  fat: "stroke-fat",
  fiber: "stroke-fiber",
  primary: "stroke-primary",
};

const format = (value: number) => Math.round(value).toLocaleString("en-US");

export type NutrientRingProps = {
  value: number;
  target: number | null;
  /** "Calories" */
  label: string;
  /** "kcal" */
  unit: string;
  color?: NutrientColor;
  /** Diameter in px. */
  size?: number;
  className?: string;
};

/**
 * A progress ring with the amount eaten in large numbers in the middle and the target below it.
 * Past the target the ring stays full and the text says by how much.
 */
export const NutrientRing = ({
  value,
  target,
  label,
  unit,
  color = "energy",
  size = 176,
  className,
}: NutrientRingProps) => {
  const stroke = Math.max(10, Math.round(size * 0.075));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const share = target && target > 0 ? Math.min(1, value / target) : 0;
  const over = target && target > 0 ? value - target : 0;
  const spoken = target
    ? `${label}: ${format(value)} of ${format(target)} ${unit}`
    : `${label}: ${format(value)} ${unit}`;

  return (
    <div
      role="img"
      aria-label={spoken}
      className={cn("relative inline-grid place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-surface-3"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - share)}
          className={cn(STROKES[color], "transition-[stroke-dashoffset] duration-500 ease-out")}
        />
      </svg>
      <div
        aria-hidden
        className="absolute inset-0 flex flex-col items-center justify-center text-center"
      >
        <span className="tabular text-display">{format(value)}</span>
        <span className="text-caption text-muted mt-1">
          {target ? `of ${format(target)} ${unit}` : unit}
        </span>
        {over > 0 && (
          <span className="text-caption text-danger mt-0.5 font-semibold">{format(over)} over</span>
        )}
      </div>
    </div>
  );
};
