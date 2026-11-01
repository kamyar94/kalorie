"use client";

import * as RadixSlider from "@radix-ui/react-slider";

import { cn } from "./cn";

export type SliderProps = {
  value: number;
  onValueChange: (value: number) => void;
  /** Called when the person lets go (save here, not on every move). */
  onValueCommit?: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Spoken name, for example "Grams". */
  label: string;
  /** Spoken value, for example "180 grams". */
  valueText?: string;
  disabled?: boolean;
  className?: string;
};

/** A single-thumb slider with a 44 px touch area and keyboard steps. */
export const Slider = ({
  value,
  onValueChange,
  onValueCommit,
  min,
  max,
  step = 1,
  label,
  valueText,
  disabled,
  className,
}: SliderProps) => (
  <RadixSlider.Root
    className={cn("relative flex h-11 w-full touch-none items-center select-none", className)}
    value={[value]}
    min={min}
    max={max}
    step={step}
    disabled={disabled}
    onValueChange={([v]) => {
      if (v !== undefined) onValueChange(v);
    }}
    onValueCommit={([v]) => {
      if (v !== undefined) onValueCommit?.(v);
    }}
  >
    <RadixSlider.Track className="bg-surface-3 relative h-2 grow overflow-hidden rounded-full">
      <RadixSlider.Range className="bg-primary absolute h-full rounded-full" />
    </RadixSlider.Track>
    <RadixSlider.Thumb
      aria-label={label}
      aria-valuetext={valueText}
      className="border-primary bg-surface shadow-raised block size-7 rounded-full border-2 transition-transform active:scale-110"
    />
  </RadixSlider.Root>
);
