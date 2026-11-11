import { Activity, Dumbbell, Footprints, HeartPulse, PersonStanding, Trophy } from "lucide-react";

import { cn } from "@/components/ui/cn";
import type { ActivityCategory } from "@/lib/contracts/activities";

/** One colour per category (the chart tokens), used by its icon and its progress bar. */
export const CATEGORY_COLOR: Record<ActivityCategory, { text: string; bar: string }> = {
  cardio: { text: "text-energy", bar: "bg-energy" },
  strength: { text: "text-protein", bar: "bg-protein" },
  walking: { text: "text-fiber", bar: "bg-fiber" },
  mobility: { text: "text-fat", bar: "bg-fat" },
  sports: { text: "text-carbs", bar: "bg-carbs" },
  other: { text: "text-water", bar: "bg-water" },
};

const ICONS = {
  cardio: HeartPulse,
  strength: Dumbbell,
  walking: Footprints,
  mobility: PersonStanding,
  sports: Trophy,
  other: Activity,
} as const;

/** The category's icon on a 40 px tile (decorative: the category is always written next to it). */
export const CategoryIcon = ({
  category,
  className,
}: {
  category: ActivityCategory;
  className?: string;
}) => {
  const Icon = ICONS[category];
  return (
    <span
      aria-hidden
      className={cn(
        "bg-surface-2 grid size-10 shrink-0 place-items-center rounded-xl",
        CATEGORY_COLOR[category].text,
        className,
      )}
    >
      <Icon className="size-5.5" />
    </span>
  );
};
