import type { WeightPointDto } from "@/lib/contracts/integrations";
import { shortDate } from "@/lib/ui/format";

const WIDTH = 356;
const HEIGHT = 90;
const PAD = 6;

/**
 * The weight line of the last months (board 11): one point a day, the latest marked. A light SVG
 * with a spoken summary; the numbers are in the card and the history under it.
 */
export const WeightChart = ({
  weights,
  format,
}: {
  weights: WeightPointDto[];
  /** The weight as shown ("113.6 kg", "250.4 lb"). */
  format: (kg: number) => string;
}) => {
  if (weights.length < 2) return null;
  const first = weights[0]!;
  const last = weights.at(-1)!;
  const start = Date.parse(`${first.date}T12:00:00Z`);
  const span = Math.max(1, Date.parse(`${last.date}T12:00:00Z`) - start);
  const kgs = weights.map((w) => w.kg);
  const low = Math.min(...kgs);
  const high = Math.max(...kgs);
  const range = Math.max(0.5, high - low);
  const x = (date: string) =>
    PAD + ((Date.parse(`${date}T12:00:00Z`) - start) / span) * (WIDTH - 2 * PAD);
  const y = (kg: number) => PAD + ((high - kg) / range) * (HEIGHT - 2 * PAD);
  const points = weights.map((w) => `${x(w.date).toFixed(1)},${y(w.kg).toFixed(1)}`).join(" ");
  return (
    <svg
      role="img"
      aria-label={`Weight from ${shortDate(first.date)} to ${shortDate(last.date)}: ${format(first.kg)} to ${format(last.kg)}`}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-auto w-full"
      fill="none"
    >
      <path d={`M0 ${HEIGHT - 0.5}H${WIDTH}`} className="stroke-border" />
      <polyline
        points={points}
        className="stroke-primary"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={x(last.date)} cy={y(last.kg)} r={5} className="fill-primary" />
    </svg>
  );
};
