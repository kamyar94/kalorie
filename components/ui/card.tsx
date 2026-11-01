import type { HTMLAttributes } from "react";

import { cn } from "./cn";

export type CardProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article" | "li";
  /** Adds hover and press feedback for cards that open something. */
  interactive?: boolean;
  padded?: boolean;
};

/** A rounded surface that groups related content. */
export const Card = ({
  as: Tag = "div",
  interactive,
  padded = true,
  className,
  ...props
}: CardProps) => (
  <Tag
    className={cn(
      "border-border bg-surface shadow-card rounded-[var(--radius-card)] border",
      padded && "p-4",
      interactive && "hover:bg-surface-2/40 transition-transform duration-150 active:scale-[0.99]",
      className,
    )}
    {...props}
  />
);
