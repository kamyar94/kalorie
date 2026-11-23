import { cn } from "@/components/ui/cn";
import { scoreBand, scoreLabel, type ScoreBand } from "@/lib/balance/score";

const RING: Record<ScoreBand, string> = {
  good: "border-balance-good",
  fair: "border-balance-fair",
  low: "border-balance-low",
};

/**
 * A meal's balance score in a ring (boards 41 and 43): the number in the text colour, the ring in
 * the band's colour (good, fair, low). Read as "Balance score 91 of 100, well balanced", so the
 * colour is never the only signal.
 */
export const ScoreRing = ({ score, className }: { score: number; className?: string }) => (
  <span
    role="img"
    aria-label={scoreLabel(score)}
    data-band={scoreBand(score)}
    className={cn(
      "tabular grid size-12 shrink-0 place-items-center rounded-full border-4 text-base font-extrabold",
      RING[scoreBand(score)],
      className,
    )}
  >
    {score}
  </span>
);

/** A meal's picture in a list row: its cover photo, else its first food's emoji (or a plate). */
export const MealThumb = ({
  photoUrl,
  foods,
}: {
  photoUrl: string | null;
  foods: { emoji: string; drink: boolean }[];
}) =>
  photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- an authenticated thumbnail route
    <img
      src={photoUrl}
      alt=""
      width={44}
      height={44}
      loading="lazy"
      className="bg-surface-2 size-11 shrink-0 rounded-xl object-cover"
    />
  ) : (
    <span
      aria-hidden
      className="bg-surface-2 grid size-11 shrink-0 place-items-center rounded-xl text-[1.375rem] leading-none"
    >
      {(foods.find((f) => !f.drink) ?? foods[0])?.emoji ?? "🍽️"}
    </span>
  );
