"use client";

import { useRef } from "react";

import { cn } from "@/components/ui/cn";

/**
 * What the camera captures. Each kind is one tab of the control above the shutter; a new kind
 * (body photos) is one more entry here and its own branch in camera-screen.tsx.
 */
export const CAPTURE_KINDS = [
  { id: "meal", label: "Meal" },
  { id: "medicine", label: "Medicine" },
] as const;

export type CaptureKind = (typeof CAPTURE_KINDS)[number]["id"];

export const captureTabId = (base: string, kind: CaptureKind) => `${base}-tab-${kind}`;

/**
 * The centred segmented control "Meal · Medicine" on the camera (a tab list: arrow keys move
 * between the tabs and choose at once, Home and End go to the ends). panelId names the element
 * the tabs control.
 */
export const CaptureTabs = ({
  value,
  onChange,
  idBase,
  panelId,
  disabled,
}: {
  value: CaptureKind;
  onChange: (kind: CaptureKind) => void;
  idBase: string;
  panelId: string;
  disabled?: boolean;
}) => {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const select = (index: number) => {
    const count = CAPTURE_KINDS.length;
    const next = CAPTURE_KINDS[(index + count) % count]!;
    onChange(next.id);
    tabs.current[(index + count) % count]?.focus();
  };
  const current = CAPTURE_KINDS.findIndex((kind) => kind.id === value);
  return (
    <div
      role="tablist"
      aria-label="What to capture"
      className="flex gap-1 self-center rounded-full bg-white/12 p-1"
      onKeyDown={(event) => {
        const moves: Record<string, number> = {
          ArrowRight: current + 1,
          ArrowLeft: current - 1,
          Home: 0,
          End: CAPTURE_KINDS.length - 1,
        };
        const target = moves[event.key];
        if (target === undefined || disabled) return;
        event.preventDefault();
        select(target);
      }}
    >
      {CAPTURE_KINDS.map((kind, index) => {
        const selected = kind.id === value;
        return (
          <button
            key={kind.id}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            id={captureTabId(idBase, kind.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            disabled={disabled && !selected}
            onClick={() => onChange(kind.id)}
            className={cn(
              "min-h-11 rounded-full px-4 text-sm transition-colors disabled:opacity-50",
              selected
                ? "bg-white font-bold text-black"
                : "bg-transparent font-semibold text-white",
            )}
          >
            {kind.label}
          </button>
        );
      })}
    </div>
  );
};
