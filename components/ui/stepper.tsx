"use client";

import { Minus, Plus } from "lucide-react";

import { cn } from "./cn";

export type StepperProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Spoken name, for example "Servings". */
  label: string;
  format?: (value: number) => string;
  className?: string;
};

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Minus, value, plus. Buttons are 44 px; arrow keys change the value too. */
export const Stepper = ({
  value,
  onChange,
  min = 0,
  max = 99,
  step = 1,
  label,
  format = (v) => String(v),
  className,
}: StepperProps) => {
  const set = (next: number) => onChange(round(Math.min(max, Math.max(min, next))));
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("bg-surface-2 inline-flex items-center gap-1 rounded-full p-1", className)}
    >
      <button
        type="button"
        aria-label={`Less (${label})`}
        disabled={value <= min}
        onClick={() => set(value - step)}
        className="text-text hover:bg-surface-3 grid size-11 place-items-center rounded-full disabled:opacity-40"
      >
        <Minus aria-hidden className="size-5" />
      </button>
      <div
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={format(value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowRight") {
            event.preventDefault();
            set(value + step);
          }
          if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
            event.preventDefault();
            set(value - step);
          }
        }}
        className="tabular text-headline min-w-12 rounded-md text-center"
      >
        {format(value)}
      </div>
      <button
        type="button"
        aria-label={`More (${label})`}
        disabled={value >= max}
        onClick={() => set(value + step)}
        className="text-text hover:bg-surface-3 grid size-11 place-items-center rounded-full disabled:opacity-40"
      >
        <Plus aria-hidden className="size-5" />
      </button>
    </div>
  );
};
