import { cn } from "@/components/ui/cn";
import type { MoveGoals } from "@/lib/contracts/move";
import { goalCaption, ringLabel, ringValue } from "@/lib/move/words";

const NAMES: Record<keyof MoveGoals, string> = {
  steps: "Steps",
  activeMinutes: "Active time",
  activeKcal: "Activity calories",
};

/** Each number keeps its own colour (board 39): steps green, active time blue, calories orange. */
const STROKE: Record<keyof MoveGoals, string> = {
  steps: "stroke-primary",
  activeMinutes: "stroke-protein",
  activeKcal: "stroke-energy",
};

const R = 43.5;
const C = 2 * Math.PI * R;

/**
 * One of the day's three rings (board 39): the number in the middle, its name and goal under it.
 * The ring fills towards the goal and stays full past it; the spoken name says the number, the
 * goal and "goal reached", so the colour is never the only signal. Scales down on narrow screens.
 */
export const GoalRing = ({
  kind,
  value,
  goal,
}: {
  kind: keyof MoveGoals;
  /** Null: no number from the phone ("–", an empty ring). */
  value: number | null;
  goal: number;
}) => {
  const share = value !== null && goal > 0 ? Math.min(1, value / goal) : 0;
  const centre = ringValue(kind, value);
  return (
    <div
      className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center"
      data-testid={`move-ring-${kind}`}
    >
      <div
        role="img"
        aria-label={ringLabel(kind, value, goal)}
        className="relative aspect-square w-full max-w-24"
      >
        <svg viewBox="0 0 96 96" className="size-full" aria-hidden>
          <circle cx={48} cy={48} r={R} fill="none" strokeWidth={9} className="stroke-surface-3" />
          {share > 0 && (
            <circle
              cx={48}
              cy={48}
              r={R}
              fill="none"
              strokeWidth={9}
              strokeLinecap="round"
              strokeDasharray={`${C * share} ${C}`}
              transform="rotate(-90 48 48)"
              className={STROKE[kind]}
            />
          )}
        </svg>
        <div
          aria-hidden
          className="absolute inset-0 flex flex-col items-center justify-center leading-tight"
        >
          <span className="tabular text-[1.0625rem] font-extrabold">{centre.value}</span>
          <span className="text-muted text-[0.6875rem]">{centre.unit}</span>
        </div>
      </div>
      <span aria-hidden className="text-label leading-tight">
        {NAMES[kind]}
      </span>
      <span aria-hidden className={cn("text-muted text-[0.6875rem] leading-tight")}>
        {goalCaption(kind, goal)}
      </span>
    </div>
  );
};
