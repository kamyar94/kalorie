import { ScoreRing } from "@/components/balance/score-ring";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import {
  BALANCE_NAMES,
  balanceOf,
  balanceWord,
  listWords,
  NOT_JUDGED_WORDS,
  partAmounts,
  partState,
  type EncouragedPart,
  type LimitedPart,
} from "@/lib/balance/score";
import type { MealSlot, MealStatus } from "@/lib/contracts/meals";
import type { NutrientCode, NutrientMap } from "@/lib/contracts/nutrients";
import type { NutrientTarget } from "@/lib/contracts/targets";

const TONE = {
  good: "text-primary",
  fair: "text-on-warning-soft",
  low: "text-danger",
  muted: "text-muted font-normal",
} as const;

const Row = ({ part }: { part: EncouragedPart | LimitedPart }) => {
  const state = partState(part);
  return (
    <li className="border-border text-body flex min-h-10 flex-wrap items-center gap-x-2 border-t py-1.5">
      <span className="min-w-0 flex-1">{BALANCE_NAMES[part.code]}</span>
      <span className="text-caption text-muted tabular">{partAmounts(part)}</span>
      <span className={cn("tabular min-w-14 text-right font-bold", TONE[state.tone])}>
        {state.text}
      </span>
    </li>
  );
};

/**
 * The meal page's balance card (board 43), under the totals: the score with its reason and the
 * size sentence, each nutrient with its amount against this meal's share (or limit) and how it
 * did, and the sentence that explains the shares. Worked out on the device from the same totals,
 * so it follows the item edits at once. A meal that is not judged says why.
 */
export const BalanceCard = ({
  totals,
  slot,
  status,
  drinksOnly,
  targets,
}: {
  totals: NutrientMap;
  slot: MealSlot;
  status: MealStatus;
  drinksOnly: boolean;
  targets: Partial<Record<NutrientCode, NutrientTarget>>;
}) => {
  const balance = balanceOf({ totals, slot, status, drinksOnly }, targets);
  if (!balance.judged)
    return (
      <Card
        as="section"
        aria-labelledby="balance-heading"
        className="flex flex-col gap-1"
        data-testid="meal-balance"
      >
        <h2 id="balance-heading" className="text-headline">
          Balance: not enough to judge
        </h2>
        <p className="text-caption text-muted">{NOT_JUDGED_WORDS[balance.why]}</p>
      </Card>
    );
  const parts = [...balance.encouraged, ...balance.limited];
  const known = parts.filter((p) => p.state !== "unknown");
  const unknown = parts.filter((p) => p.state === "unknown");
  return (
    <Card
      as="section"
      aria-labelledby="balance-heading"
      className="flex flex-col gap-2.5"
      data-testid="meal-balance"
    >
      <div className="flex items-center gap-3">
        <ScoreRing score={balance.score} />
        <div className="min-w-0 flex-1">
          <h2 id="balance-heading" className="text-headline">
            Balance {balance.score} of 100
          </h2>
          <p className="text-caption text-muted" data-testid="balance-reason">
            {balance.reason}. {balance.size}
          </p>
        </div>
      </div>
      <ul aria-label="Nutrients against this meal's share">
        {known.map((part) => (
          <Row key={part.code} part={part} />
        ))}
      </ul>
      {unknown.length > 0 && (
        <p className="text-caption text-muted">
          Not known for this meal: {listWords(unknown.map((p) => balanceWord(p.code)))}.
        </p>
      )}
      <p className="text-caption text-muted" data-testid="balance-shares">
        {balance.shareSentence}
      </p>
    </Card>
  );
};
