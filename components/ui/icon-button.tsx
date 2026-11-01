import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "./cn";

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Spoken name of the button; icons alone say nothing to a screen reader. */
  label: string;
  variant?: "ghost" | "secondary" | "primary";
  size?: "md" | "lg";
};

/** A square 44 px (or 52 px) button holding one icon. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = "ghost", size = "md", className, type, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-150 disabled:opacity-50",
        size === "md" ? "size-11" : "size-13",
        variant === "ghost" && "text-text hover:bg-surface-2",
        variant === "secondary" && "bg-surface-2 text-text hover:bg-surface-3",
        variant === "primary" && "bg-primary text-on-primary hover:bg-primary-hover",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
