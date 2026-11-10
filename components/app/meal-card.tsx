import { AlertCircle, CloudOff, HelpCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { PlateIcon } from "@/components/app/plate-icon";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { shortFoodName } from "@/lib/food/emoji";
import {
  MEAL_SLOT_LABELS,
  type LocalMealState,
  type MealStatus,
  type MealSummaryDto,
} from "@/lib/contracts/meals";

export const STATE_TEXT: Record<MealStatus | LocalMealState, string> = {
  waiting: "Waiting to upload",
  uploading: "Uploading",
  queued: "Waiting to analyse",
  analysing: "Analysing",
  needs_input: "Needs an answer",
  ready: "",
  failed: "Needs attention",
};

export type MealCardProps = {
  meal: Pick<
    MealSummaryDto,
    | "id"
    | "localTime"
    | "slot"
    | "title"
    | "status"
    | "photos"
    | "totals"
    | "itemCount"
    | "foods"
    | "waterMl"
    | "error"
  >;
  /** A meal still on the device shows its local state instead of the server status. */
  localState?: LocalMealState;
  /** Preview URL of a photo not uploaded yet. */
  previewUrl?: string;
  /** Makes the whole card open this page. */
  href?: string;
  /** One line under the state, for example why it failed. */
  detail?: string;
  /** Buttons under the card text (retry, settings link); they stay clickable above the link. */
  actions?: ReactNode;
  className?: string;
};

/** "🍳 Egg · 🍞 Toast · 🍵 Tea": the meal's foods with their emojis, short names. */
export const foodsLine = (foods: MealSummaryDto["foods"]) =>
  foods.map((food) => `${food.emoji} ${shortFoodName(food.name)}`).join(" · ");

/**
 * One meal on the Today timeline: photo (or, without one, a plate with its foods), time, title,
 * calories and state.
 */
export const MealCard = ({
  meal,
  localState,
  previewUrl,
  href,
  detail,
  actions,
  className,
}: MealCardProps) => {
  const state = localState ?? meal.status;
  const kcal = meal.totals?.energy;
  const thumb = previewUrl ?? meal.photos[0]?.urls.thumb;
  const pending = state === "uploading" || state === "queued" || state === "analysing";
  const title = meal.title ?? MEAL_SLOT_LABELS[meal.slot];
  const spoken = `${title} at ${meal.localTime}${STATE_TEXT[state] ? `, ${STATE_TEXT[state].toLowerCase()}` : ""}`;
  const showKcal = typeof kcal === "number" && (state === "ready" || state === "needs_input");
  const drinksOnly = meal.foods.length > 0 && meal.foods.every((food) => food.drink);

  return (
    <Card
      as="article"
      padded={false}
      data-meal-id={meal.id}
      data-state={state}
      aria-label={spoken}
      className={cn(
        "relative flex items-center gap-3 p-2.5 pr-4",
        href && "hover:bg-surface-2/50 transition-colors",
        state === "failed" && "border-danger/40",
        className,
      )}
    >
      <div
        className={cn(
          "relative size-14 shrink-0 self-start overflow-hidden",
          thumb ? "bg-surface-2 rounded-[0.875rem]" : "rounded-full",
        )}
      >
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin photo
          <img
            src={thumb}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <PlateIcon foods={meal.foods} label={meal.foods.length ? undefined : "Empty plate"} />
        )}
        {pending && (
          <div className="absolute inset-0 grid place-items-center bg-black/30">
            <Loader2
              aria-hidden
              className="size-6 animate-spin text-white motion-reduce:animate-none"
            />
          </div>
        )}
        {state === "waiting" && (
          <div className="absolute inset-0 grid place-items-center bg-black/30">
            <CloudOff aria-hidden className="size-6 text-white" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-caption text-muted">
          <span className="tabular">{meal.localTime}</span> · {MEAL_SLOT_LABELS[meal.slot]}
        </p>
        <h3 dir="auto" className="text-headline truncate">
          {href ? (
            <Link
              href={href}
              className="after:absolute after:inset-0 after:rounded-[var(--radius-card)] focus-visible:outline-none focus-visible:after:outline-3 focus-visible:after:outline-[var(--focus)]"
            >
              {title}
            </Link>
          ) : (
            title
          )}
        </h3>
        {STATE_TEXT[state] ? (
          <p
            className={cn(
              "text-caption mt-0.5 inline-flex items-center gap-1 font-medium",
              state === "failed"
                ? "text-danger"
                : state === "needs_input"
                  ? "text-on-warning-soft bg-warning-soft rounded-full px-2 py-0.5"
                  : "text-muted",
            )}
          >
            {state === "failed" && <AlertCircle aria-hidden className="size-3.5" />}
            {state === "needs_input" && <HelpCircle aria-hidden className="size-3.5" />}
            <span data-testid="meal-state">{STATE_TEXT[state]}</span>
          </p>
        ) : (
          <p className="text-caption text-muted mt-0.5 truncate" data-testid="meal-foods">
            {meal.foods.length ? foodsLine(meal.foods) : "No items yet"}
            {drinksOnly && meal.waterMl > 0 && (
              <>
                {" · "}
                <span className="text-water font-semibold" data-testid="meal-water">
                  +{Math.round(meal.waterMl).toLocaleString("en-US")} ml water
                </span>
              </>
            )}
          </p>
        )}
        {detail && <p className="text-caption text-muted mt-0.5 line-clamp-2">{detail}</p>}
        {actions && <div className="relative z-10 mt-2 flex flex-wrap gap-2">{actions}</div>}
      </div>
      {showKcal && (
        <div className="shrink-0 self-start pt-1 text-right">
          <p className="tabular text-title">{Math.round(kcal).toLocaleString("en-US")}</p>
          <p className="text-caption text-muted">kcal</p>
        </div>
      )}
    </Card>
  );
};
