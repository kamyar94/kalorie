import { useId, type InputHTMLAttributes } from "react";

import { cn } from "./cn";

export type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
};

/** A labelled text input, 48 px tall, with an optional hint under it. */
export const Field = ({ label, hint, className, id, ...props }: FieldProps) => {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={inputId} className="text-label">
        {label}
      </label>
      <input
        id={inputId}
        aria-describedby={hintId}
        className="border-border bg-surface text-body text-text placeholder:text-muted focus:border-primary focus-visible:outline-focus min-h-12 w-full min-w-0 rounded-[var(--radius-control)] border px-3.5 focus:outline-none focus-visible:outline-3 focus-visible:outline-offset-0"
        {...props}
      />
      {hint && (
        <p id={hintId} className="text-caption text-muted">
          {hint}
        </p>
      )}
    </div>
  );
};
