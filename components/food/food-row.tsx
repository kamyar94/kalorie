import { ChevronRight, UserRound } from "lucide-react";

import type { FoodResult } from "@/lib/contracts/food-search";
import { formatKcal } from "@/lib/ui/format";

/** One food in a list: names, brand, energy per 100 g, and whether it is the person's own. */
export const FoodRow = ({
  food,
  onPick,
  detail,
}: {
  food: FoodResult;
  onPick: () => void;
  /** Replaces the energy line, for example "Last time: 180 g". */
  detail?: string;
}) => (
  <button
    type="button"
    onClick={onPick}
    className="hover:bg-surface-2 flex min-h-16 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors"
  >
    <span className="min-w-0 flex-1">
      <span className="text-body flex items-center gap-1.5 font-medium">
        <span dir="auto" className="truncate">
          {food.nameEn}
        </span>
        {food.personal && (
          <span className="bg-primary-soft text-on-primary-soft text-caption inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5">
            <UserRound aria-hidden className="size-3" /> Yours
          </span>
        )}
      </span>
      {(food.nameFa || food.brand) && (
        <span className="text-caption text-muted block truncate" dir="auto">
          {[food.brand, food.nameFa].filter(Boolean).join(" · ")}
        </span>
      )}
      <span className="text-caption text-muted block">
        {detail ?? `${formatKcal(food.per100g.energy)} kcal per 100 g`}
      </span>
    </span>
    <ChevronRight aria-hidden className="text-muted size-5 shrink-0" />
  </button>
);
