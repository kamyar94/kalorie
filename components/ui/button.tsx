import { Slot } from "@radix-ui/react-slot";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover shadow-card",
  secondary: "bg-surface-2 text-text hover:bg-surface-3",
  ghost: "bg-transparent text-text hover:bg-surface-2",
  danger: "bg-danger text-on-danger hover:opacity-90",
};

const SIZES: Record<ButtonSize, string> = {
  md: "min-h-11 px-4 text-label",
  lg: "min-h-13 px-6 text-headline",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Shows a spinner, keeps the width and blocks presses. */
  loading?: boolean;
  /** Render the child element (for example a Link) with the button's look. */
  asChild?: boolean;
};

/** The main action control: at least 44 px tall, clear focus ring, a loading state. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    fullWidth,
    loading,
    asChild,
    className,
    disabled,
    children,
    type,
    ...props
  },
  ref,
) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      ref={ref}
      type={asChild ? undefined : (type ?? "button")}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-semibold transition-colors duration-150 select-none disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && (
            <span
              aria-hidden
              className="absolute inset-0 m-auto size-5 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
          )}
          <span className={cn("inline-flex items-center gap-2", loading && "invisible")}>
            {children}
          </span>
        </>
      )}
    </Component>
  );
});
