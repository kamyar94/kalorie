import { cn } from "@/components/ui/cn";
import { shortFoodName } from "@/lib/food/emoji";

export type PlateFood = { name: string; emoji: string };

/** "rice", "rice and chicken", "rice, chicken and salad". */
const listNames = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** What the plate says to a screen reader: "Plate with rice, chicken and salad". */
export const plateLabel = (foods: PlateFood[]) => {
  const names = [...new Set(foods.map((f) => shortFoodName(f.name).toLowerCase()))].filter(Boolean);
  return names.length ? `Plate with ${listNames(names.slice(0, 6))}` : "Empty plate";
};

const SIZES = {
  // Timeline card: 56 px plate, 44 px inner plate.
  sm: {
    outer: "size-14",
    inner: "size-11",
    one: "text-[1.375rem]",
    two: "text-base",
    more: "text-[0.9375rem]",
  },
  // Meal page header: 112 px plate, 90 px inner plate.
  lg: {
    outer: "size-28",
    inner: "size-[5.625rem]",
    one: "text-5xl",
    two: "text-[2rem]",
    more: "text-[1.75rem]",
  },
} as const;

/**
 * The picture of a meal without a photo: a plate with up to four of its foods as emojis (one
 * centred and large, two side by side, three as two over one, four as two by two). Without foods
 * (a meal described in words still being worked out) the plate is empty.
 */
export const PlateIcon = ({
  foods,
  size = "sm",
  label,
  className,
}: {
  foods: PlateFood[];
  size?: keyof typeof SIZES;
  /** Overrides the spoken name (for example while the meal is still analysed). */
  label?: string;
  className?: string;
}) => {
  const s = SIZES[size];
  const shown = foods.slice(0, 4);
  return (
    <div
      role="img"
      aria-label={label ?? plateLabel(foods)}
      className={cn(
        "bg-surface-2 grid shrink-0 place-items-center rounded-full",
        s.outer,
        className,
      )}
    >
      <div
        aria-hidden
        className={cn(
          "border-border bg-surface rounded-full border leading-none",
          s.inner,
          shown.length <= 1 && "grid place-items-center",
          shown.length === 1 && s.one,
          shown.length === 2 && cn("flex items-center justify-center gap-px", s.two),
          shown.length >= 3 &&
            cn(
              "grid grid-cols-2 content-center justify-items-center gap-y-0.5 leading-[1.15]",
              s.more,
            ),
        )}
      >
        {shown.map((food, i) => (
          <span key={i} className={cn(shown.length === 3 && i === 2 && "col-span-2")}>
            {food.emoji}
          </span>
        ))}
      </div>
    </div>
  );
};
