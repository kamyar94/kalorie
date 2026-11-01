import { cn } from "@/components/ui/cn";
import type { NutrientMap } from "@/lib/contracts/nutrients";
import { formatKcal } from "@/lib/ui/format";

const MACROS = [
  { code: "protein", label: "Protein", dot: "bg-protein" },
  { code: "carbs", label: "Carbs", dot: "bg-carbs" },
  { code: "fat", label: "Fat", dot: "bg-fat" },
] as const;

const grams = (value: number | undefined) =>
  typeof value === "number" ? `${value < 10 ? value.toFixed(1) : Math.round(value)} g` : "–";

/** Calories in large numbers with protein, carbs and fat beside them. */
export const MacroSummary = ({
  nutrients,
  className,
  size = "md",
}: {
  nutrients: NutrientMap;
  className?: string;
  size?: "md" | "lg";
}) => (
  <div className={cn("flex items-center gap-4", className)} data-testid="macro-summary">
    <div className="shrink-0">
      <p
        className={cn(
          "tabular leading-none font-bold",
          size === "lg" ? "text-display" : "text-title",
        )}
        data-testid="kcal"
      >
        {formatKcal(nutrients.energy)}
      </p>
      <p className="text-caption text-muted mt-1">kcal</p>
    </div>
    <dl className="grid flex-1 grid-cols-3 gap-2">
      {MACROS.map((macro) => (
        <div key={macro.code} className="bg-surface-2 rounded-xl px-2.5 py-2">
          <dt className="text-caption text-muted inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 rounded-full", macro.dot)} />
            {macro.label}
          </dt>
          <dd className="tabular text-label">{grams(nutrients[macro.code])}</dd>
        </div>
      ))}
    </dl>
  </div>
);
