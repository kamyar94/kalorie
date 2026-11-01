"use client";

import * as ToggleGroup from "@radix-ui/react-toggle-group";

import { cn } from "./cn";

export type SegmentedOption<T extends string> = { value: T; label: string };

export type SegmentedControlProps<T extends string> = {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentedOption<T>[];
  /** Spoken name of the group. */
  label: string;
  className?: string;
};

/** Two to four mutually exclusive choices side by side (day, week, month). */
export const SegmentedControl = <T extends string>({
  value,
  onValueChange,
  options,
  label,
  className,
}: SegmentedControlProps<T>) => (
  <ToggleGroup.Root
    type="single"
    aria-label={label}
    value={value}
    onValueChange={(next) => {
      if (next) onValueChange(next as T);
    }}
    className={cn(
      "bg-surface-2 grid auto-cols-fr grid-flow-col gap-1 rounded-[var(--radius-control)] p-1",
      className,
    )}
  >
    {options.map((option) => (
      <ToggleGroup.Item
        key={option.value}
        value={option.value}
        className="text-label text-muted data-[state=on]:bg-surface data-[state=on]:text-text data-[state=on]:shadow-card min-h-11 rounded-[calc(var(--radius-control)-0.25rem)] px-3 transition-colors"
      >
        {option.label}
      </ToggleGroup.Item>
    ))}
  </ToggleGroup.Root>
);
