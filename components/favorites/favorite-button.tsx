"use client";

import { Star } from "lucide-react";

import { cn } from "@/components/ui/cn";

/** The star that keeps a meal among the favorites: 44 px, pressed while it is one. */
export const FavoriteButton = ({
  on,
  busy,
  onToggle,
  label = "Favorite",
  className,
}: {
  on: boolean;
  busy?: boolean;
  onToggle: () => void;
  /** The spoken name, when several stars share a screen. */
  label?: string;
  className?: string;
}) => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={on}
    aria-busy={busy || undefined}
    disabled={busy}
    onClick={onToggle}
    data-testid="favorite"
    className={cn(
      "grid size-11 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-70",
      on ? "bg-warning-soft text-carbs" : "bg-surface-2 text-text hover:bg-surface-3",
      className,
    )}
  >
    <Star
      aria-hidden
      className="size-5.5"
      fill={on ? "currentColor" : "none"}
      strokeWidth={on ? 1.5 : 2}
    />
  </button>
);
