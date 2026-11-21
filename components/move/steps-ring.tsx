import { cn } from "@/components/ui/cn";

/**
 * A ring of a day's steps against the step goal: blue while under it, green once reached (the
 * words say it too). Past the goal the ring stays full; more steps are fine.
 */
export const Ring = ({
  size,
  stroke,
  steps,
  goal,
  className,
  children,
}: {
  size: number;
  stroke: number;
  steps: number;
  goal: number;
  className?: string;
  children?: React.ReactNode;
}) => {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const share = goal > 0 ? Math.min(1, steps / goal) : 0;
  return (
    <div
      className={cn("relative grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-surface-3"
        />
        {share > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference * share} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            className={steps >= goal ? "stroke-primary" : "stroke-protein"}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {children}
      </div>
    </div>
  );
};
