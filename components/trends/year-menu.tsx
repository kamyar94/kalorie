"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@/components/ui/cn";
import type { NutrientCode } from "@/lib/contracts/nutrients";
import type { NutrientTarget } from "@/lib/contracts/targets";
import {
  metricLabel,
  targetText,
  YEAR_METRIC_GROUPS,
  yearTarget,
  type YearMetric,
  type YearTarget,
} from "@/lib/trends/year";

/**
 * The words after the metric on the closed button: "against 2,100 kcal", "goal 7,000 a day",
 * "no target set".
 */
const againstText = (code: YearMetric, target: YearTarget | null) =>
  !target
    ? "no target set"
    : target.kind === "more"
      ? `goal ${targetText(code, target)}`
      : target.kind === "max"
        ? `against the ${targetText(code, { ...target, kind: "goal" })} limit`
        : `against ${targetText(code, target)}`;

/**
 * What the year shows (boards 32 and 38): a button that opens a list of activity measures and the
 * nutrients grouped like the catalogue, each with its target or goal. Arrow keys, Home and End move, Enter or Space chooses, a letter
 * jumps to the next name starting with it, Escape or a press outside closes.
 */
export const YearMetricMenu = ({
  value,
  targets,
  waterGoalMl,
  stepGoal,
  onChange,
}: {
  value: YearMetric;
  targets: Partial<Record<NutrientCode, NutrientTarget>>;
  waterGoalMl: number;
  stepGoal: number;
  onChange: (metric: YearMetric) => void;
}) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<YearMetric>(value);
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const options = useMemo(
    () =>
      YEAR_METRIC_GROUPS.flatMap((group) =>
        group.codes.map((code) => {
          const target = yearTarget(code, targets, waterGoalMl, stepGoal);
          return { code, group: group.label, label: metricLabel(code), target };
        }),
      ),
    [targets, waterGoalMl, stepGoal],
  );
  const optionId = (code: string) => `${id}-${code}`;
  const current = options.find((o) => o.code === value) ?? options[0]!;

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popup.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  const choose = (code: YearMetric) => {
    close(true);
    if (code !== value) onChange(code);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = options.findIndex((o) => o.code === active);
    const go = (index: number) => {
      event.preventDefault();
      setActive(options[Math.max(0, Math.min(options.length - 1, index))]!.code);
    };
    switch (event.key) {
      case "ArrowDown":
        return go(at + 1);
      case "ArrowUp":
        return go(at - 1);
      case "PageDown":
        return go(at + 8);
      case "PageUp":
        return go(at - 8);
      case "Home":
        return go(0);
      case "End":
        return go(options.length - 1);
      case "Enter":
      case " ":
        event.preventDefault();
        return choose(active);
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        return close(true);
      case "Tab":
        return close(false);
    }
    if (event.key.length === 1 && /\S/.test(event.key)) {
      const letter = event.key.toLowerCase();
      const order = [...options.slice(at + 1), ...options.slice(0, at + 1)];
      const next = order.find((o) => o.label.toLowerCase().startsWith(letter));
      if (next) {
        event.preventDefault();
        setActive(next.code);
      }
    }
  };

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        onClick={() => {
          setActive(value);
          setOpen((o) => !o);
        }}
        className={cn(
          "bg-bg text-text flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--radius-control)] border px-3.5 text-left lg:w-auto lg:min-w-64",
          open ? "border-primary" : "border-border",
        )}
      >
        <span className="text-label min-w-0 truncate text-[0.9375rem]">
          <span className="sr-only">Show </span>
          {current.label}
        </span>
        <span className="text-caption text-muted inline-flex shrink-0 items-center gap-1">
          {againstText(current.code, current.target)}
          <ChevronDown aria-hidden className="size-4" />
        </span>
      </button>

      {open && (
        <div
          ref={popup}
          className="border-primary bg-surface shadow-raised absolute inset-x-0 top-full z-30 mt-1.5 flex max-h-[min(38rem,70dvh)] flex-col overflow-hidden rounded-2xl border lg:right-auto lg:w-96"
        >
          <p className="text-caption text-muted border-border border-b px-3.5 py-2.5">
            Steps and active minutes are compared with Move&apos;s goals, where more is better. Each
            nutrient is compared with its own target from Settings; a day&apos;s summary says
            whether being over or under is fine for it (more fiber is fine, more sodium is not).
          </p>
          <div
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label="Show in the year"
            tabIndex={0}
            aria-activedescendant={optionId(active)}
            onKeyDown={onKeyDown}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1.5 outline-none"
          >
            {YEAR_METRIC_GROUPS.map((group) => (
              <div key={group.label} role="group" aria-label={group.label}>
                <div
                  aria-hidden
                  className="text-muted px-3.5 pt-2.5 pb-1 text-xs font-bold tracking-wide uppercase"
                >
                  {group.label}
                </div>
                {options
                  .filter((o) => o.group === group.label)
                  .map((o) => {
                    const selected = o.code === value;
                    const target = targetText(o.code, o.target);
                    return (
                      <div
                        key={o.code}
                        id={optionId(o.code)}
                        role="option"
                        aria-selected={selected}
                        data-active={o.code === active || undefined}
                        onPointerMove={() => o.code !== active && setActive(o.code)}
                        onClick={() => choose(o.code)}
                        className={cn(
                          "text-body data-[active]:outline-focus flex min-h-11 cursor-pointer items-center gap-2 px-3.5 data-[active]:outline-2 data-[active]:-outline-offset-2",
                          selected
                            ? "bg-primary-soft text-on-primary-soft font-bold"
                            : "data-[active]:bg-surface-2",
                        )}
                      >
                        {selected ? (
                          <Check aria-hidden className="size-4 shrink-0" />
                        ) : (
                          <span aria-hidden className="size-4 shrink-0" />
                        )}
                        <span className="min-w-0">
                          {o.label}
                          {target && <span className="tabular"> · {target}</span>}
                        </span>
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
