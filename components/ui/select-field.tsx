import { ChevronDown } from "lucide-react";
import { useId, type SelectHTMLAttributes } from "react";

import { cn } from "./cn";

export type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  options: { value: string; label: string }[];
};

/** A labelled native select, 48 px tall (the platform picker is the best one on phones). */
export const SelectField = ({
  label,
  hint,
  options,
  className,
  id,
  ...props
}: SelectFieldProps) => {
  const generated = useId();
  const selectId = id ?? generated;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={selectId} className="text-label">
        {label}
      </label>
      <div className="relative">
        <select
          id={selectId}
          aria-describedby={hint ? `${selectId}-hint` : undefined}
          className="border-border bg-surface text-body text-text focus:border-primary min-h-12 w-full appearance-none rounded-[var(--radius-control)] border pr-10 pl-3.5 focus:outline-none focus-visible:outline-3 focus-visible:outline-offset-0 focus-visible:outline-[var(--focus)]"
          {...props}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          className="text-muted pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2"
        />
      </div>
      {hint && (
        <p id={`${selectId}-hint`} className="text-caption text-muted">
          {hint}
        </p>
      )}
    </div>
  );
};
