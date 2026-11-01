"use client";

import { useId } from "react";

import { cn } from "./cn";

/** An on/off switch with its label and an optional hint; 44 px tall touch area. */
export const Switch = ({
  label,
  hint,
  checked,
  disabled,
  onChange,
  className,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) => {
  const id = useId();
  return (
    <div className={cn("flex min-h-11 items-center gap-3", className)}>
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="text-body block">
          {label}
        </label>
        {hint && (
          <p id={`${id}-hint`} className="text-caption text-muted">
            {hint}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        // The button is the 44 px touch area; the visible track sits in its middle.
        className="-mr-1 grid h-11 w-15 shrink-0 place-items-center rounded-full disabled:opacity-50"
      >
        <span
          aria-hidden
          className={cn(
            "inline-flex h-8 w-13 items-center rounded-full transition-colors",
            checked ? "bg-primary" : "bg-surface-3",
          )}
        >
          <span
            className={cn(
              "bg-surface shadow-card block size-6 rounded-full transition-transform",
              checked ? "translate-x-6" : "translate-x-1",
            )}
          />
        </span>
      </button>
    </div>
  );
};
