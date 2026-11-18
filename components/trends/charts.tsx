"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/components/ui/cn";
import type { NutrientColor } from "@/components/ui/nutrient-ring";

const FILL: Record<NutrientColor, string> = {
  energy: "fill-energy",
  protein: "fill-protein",
  carbs: "fill-carbs",
  fat: "fill-fat",
  fiber: "fill-fiber",
  primary: "fill-primary",
};
const STROKE: Record<NutrientColor, string> = {
  energy: "stroke-energy",
  protein: "stroke-protein",
  carbs: "stroke-carbs",
  fat: "stroke-fat",
  fiber: "stroke-fiber",
  primary: "stroke-primary",
};

const fmt = (value: number, decimals = 0) =>
  value.toLocaleString("en-US", { maximumFractionDigits: decimals });

/** The width of an element, kept up to date (charts draw at their real pixel size). */
const useWidth = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
};

/** A friendly top for the value axis and its three gridlines. */
const niceMax = (value: number) => {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const step = steps.find((s) => s * magnitude >= value) ?? 10;
  return step * magnitude;
};

export type BarDatum = {
  key: string;
  /** Axis label; empty to skip this one (crowded axes). */
  label: string;
  /** Tooltip heading, for example "Mon, Oct 27". */
  title: string;
  value: number | null;
};

/**
 * Vertical bars from a zero baseline, with an optional dashed target line, a hover tooltip and a
 * table view for screen readers and anyone who prefers numbers. One series, one axis.
 */
export const BarChart = ({
  data,
  unit,
  color,
  target,
  label,
  decimals = 0,
  height = 168,
  goalColor,
  targetLabel = "Target",
}: {
  data: BarDatum[];
  unit: string;
  color: NutrientColor;
  target?: number | null;
  /** Names the chart for assistive technology and the table caption. */
  label: string;
  decimals?: number;
  height?: number;
  /** A goal to reach (more is fine): bars at or past the target take this colour. */
  goalColor?: NutrientColor;
  /** The word on the target line: "Target", "Goal". */
  targetLabel?: string;
}) => {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const top = 12;
  const bottom = 22;
  const left = 36;
  const plotH = height - top - bottom;
  const plotW = Math.max(0, width - left - 4);
  const max = niceMax(Math.max(target ?? 0, ...data.map((d) => d.value ?? 0)) * 1.05);
  const slot = data.length ? plotW / data.length : 0;
  const gap = Math.max(2, Math.min(8, slot * 0.25));
  const barW = Math.max(2, slot - gap);
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const hovered = active !== null ? data[active] : undefined;
  const logged = data.filter((d) => d.value !== null && d.value > 0);

  return (
    <figure className="flex flex-col gap-2">
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`${label}. ${logged.length} of ${data.length} with data.${target ? ` ${targetLabel} ${fmt(target, decimals)} ${unit}.` : ""} The table below lists every value.`}
            onPointerLeave={() => setActive(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={left}
                  x2={width}
                  y1={y(t)}
                  y2={y(t)}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={left - 6}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-[var(--text-muted)] text-[11px]"
                >
                  {fmt(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x = left + i * slot + gap / 2;
              const v = d.value ?? 0;
              const h = Math.max(0, y(0) - y(v));
              const r = Math.min(4, barW / 2, h);
              return (
                <g key={d.key}>
                  {h > 0 && (
                    <path
                      d={`M${x},${y(0)} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + barW - r} Q${x + barW},${y(v)} ${x + barW},${y(v) + r} V${y(0)} Z`}
                      className={cn(
                        FILL[goalColor && target && v >= target ? goalColor : color],
                        active !== null && active !== i && "opacity-45",
                      )}
                    />
                  )}
                  {d.label && (
                    <text
                      x={x + barW / 2}
                      y={height - 6}
                      textAnchor="middle"
                      className="fill-[var(--text-muted)] text-[11px]"
                    >
                      {d.label}
                    </text>
                  )}
                  {/* The hit area is the whole column, taller and wider than the bar. */}
                  <rect
                    x={left + i * slot}
                    y={top}
                    width={slot}
                    height={plotH}
                    fill="transparent"
                    onPointerEnter={() => setActive(i)}
                    onPointerDown={() => setActive(i)}
                  />
                </g>
              );
            })}
            {target ? (
              <g aria-hidden>
                <line
                  x1={left}
                  x2={width}
                  y1={y(target)}
                  y2={y(target)}
                  className="stroke-[var(--text)]"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                />
                <text
                  x={width - 2}
                  y={y(target) - 5}
                  textAnchor="end"
                  className="fill-[var(--text)] text-[11px] font-semibold"
                >
                  {targetLabel} {fmt(target, decimals)}
                </text>
              </g>
            ) : null}
          </svg>
        )}
        {hovered && active !== null && (
          <div
            role="presentation"
            className="border-border bg-surface shadow-raised text-caption pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border px-2.5 py-1.5 whitespace-nowrap"
            style={{
              left: Math.min(
                Math.max(left + active * slot + slot / 2, 60),
                Math.max(60, width - 60),
              ),
              top: 0,
            }}
          >
            <p className="text-muted">{hovered.title}</p>
            <p className="tabular text-label">
              {hovered.value === null
                ? "Nothing logged"
                : `${fmt(hovered.value, decimals)} ${unit}`}
            </p>
          </div>
        )}
      </div>
      <ChartTable
        caption={label}
        head={["", unit]}
        rows={data.map((d) => [d.title, d.value === null ? "–" : fmt(d.value, decimals)])}
      />
    </figure>
  );
};

export type StackSeries = {
  key: string;
  label: string;
  /** The SVG fill class and the legend's swatch class. */
  fill: string;
  swatch: string;
};

export type StackDatum = {
  key: string;
  label: string;
  title: string;
  /** Values by series key; null for a day without data. */
  values: Record<string, number> | null;
};

/**
 * Vertical bars stacked from a zero baseline (minutes by category), with a legend, a hover
 * tooltip and a table of every value.
 */
export const StackedBarChart = ({
  data,
  series,
  unit,
  label,
  height = 150,
}: {
  data: StackDatum[];
  /** Bottom first. */
  series: StackSeries[];
  unit: string;
  label: string;
  height?: number;
}) => {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const top = 12;
  const bottom = 22;
  const left = 36;
  const plotH = height - top - bottom;
  const plotW = Math.max(0, width - left - 4);
  const total = (d: StackDatum) =>
    d.values ? series.reduce((sum, s) => sum + (d.values![s.key] ?? 0), 0) : 0;
  const max = niceMax(Math.max(0, ...data.map(total)) * 1.05);
  const slot = data.length ? plotW / data.length : 0;
  const gap = Math.max(2, Math.min(8, slot * 0.25));
  const barW = Math.max(2, slot - gap);
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const hovered = active !== null ? data[active] : undefined;
  const withData = data.filter((d) => total(d) > 0).length;

  return (
    <figure className="flex flex-col gap-2">
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`${label}. ${withData} of ${data.length} with some. The table below lists every value.`}
            onPointerLeave={() => setActive(null)}
          >
            {[0, max / 2, max].map((t) => (
              <g key={t}>
                <line
                  x1={left}
                  x2={width}
                  y1={y(t)}
                  y2={y(t)}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={left - 6}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-[var(--text-muted)] text-[11px]"
                >
                  {fmt(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x = left + i * slot + gap / 2;
              let base = 0;
              return (
                <g key={d.key}>
                  {series.map((s) => {
                    const v = d.values?.[s.key] ?? 0;
                    if (v <= 0) return null;
                    const y0 = y(base);
                    base += v;
                    const y1 = y(base);
                    return (
                      <rect
                        key={s.key}
                        x={x}
                        y={y1}
                        width={barW}
                        height={Math.max(0, y0 - y1)}
                        className={cn(s.fill, active !== null && active !== i && "opacity-45")}
                      />
                    );
                  })}
                  {d.label && (
                    <text
                      x={x + barW / 2}
                      y={height - 6}
                      textAnchor="middle"
                      className="fill-[var(--text-muted)] text-[11px]"
                    >
                      {d.label}
                    </text>
                  )}
                  <rect
                    x={left + i * slot}
                    y={top}
                    width={slot}
                    height={plotH}
                    fill="transparent"
                    onPointerEnter={() => setActive(i)}
                    onPointerDown={() => setActive(i)}
                  />
                </g>
              );
            })}
          </svg>
        )}
        {hovered && active !== null && (
          <div
            role="presentation"
            className="border-border bg-surface shadow-raised text-caption pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border px-2.5 py-1.5 whitespace-nowrap"
            style={{
              left: Math.min(
                Math.max(left + active * slot + slot / 2, 70),
                Math.max(70, width - 70),
              ),
              top: 0,
            }}
          >
            <p className="text-muted">{hovered.title}</p>
            {hovered.values === null ? (
              <p className="text-label">Nothing logged</p>
            ) : (
              <p className="tabular text-label">
                {fmt(total(hovered))} {unit}
                {series
                  .filter((s) => (hovered.values![s.key] ?? 0) > 0)
                  .map((s) => (
                    <span key={s.key} className="text-muted block font-normal">
                      {s.label} {fmt(hovered.values![s.key]!)}
                    </span>
                  ))}
              </p>
            )}
          </div>
        )}
      </div>
      {series.length > 0 && (
        <ul aria-label="Colours" className="flex flex-wrap gap-x-3 gap-y-1">
          {series.map((s) => (
            <li key={s.key} className="text-caption text-muted inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2.5 rounded-[3px]", s.swatch)} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <ChartTable
        caption={label}
        head={["", ...series.map((s) => s.label), `Total, ${unit}`]}
        rows={data.map((d) => [
          d.title,
          ...series.map((s) => (d.values === null ? "–" : fmt(d.values[s.key] ?? 0))),
          d.values === null ? "–" : fmt(total(d)),
        ])}
      />
    </figure>
  );
};

/** A collapsed table with the chart's numbers. */
export const ChartTable = ({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: ReactNode[][];
}) => (
  <details className="text-caption">
    <summary className="text-muted hover:text-text min-h-8 cursor-pointer py-1">
      Show as a table
    </summary>
    <table className="mt-1 w-full border-collapse">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th
              key={i}
              scope="col"
              className={cn("text-muted py-1 font-medium", i ? "text-right" : "text-left")}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r} className="border-border border-t">
            {row.map((cell, i) =>
              i === 0 ? (
                <th key={i} scope="row" className="py-1 text-left font-normal">
                  {cell}
                </th>
              ) : (
                <td key={i} className="tabular py-1 text-right">
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  </details>
);

export type LinePoint = { key: string; label: string; title: string; value: number };

/** A single line over time (body weight) with a crosshair tooltip. */
export const LineChart = ({
  points,
  unit,
  label,
  color = "primary",
  height = 160,
  decimals = 1,
}: {
  points: LinePoint[];
  unit: string;
  label: string;
  color?: NutrientColor;
  height?: number;
  decimals?: number;
}) => {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const top = 14;
  const bottom = 22;
  const left = 40;
  const plotW = Math.max(0, width - left - 8);
  const plotH = height - top - bottom;
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(0.5, (hi - lo) * 0.15);
  const min = Math.floor(lo - pad);
  const max = Math.ceil(hi + pad);
  const x = (i: number) =>
    left + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => top + plotH - ((v - min) / Math.max(1e-9, max - min)) * plotH;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" ");
  const hovered = active !== null ? points[active] : undefined;

  return (
    <figure className="flex flex-col gap-2">
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 && points.length > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`${label}: from ${fmt(points[0]!.value, decimals)} to ${fmt(points.at(-1)!.value, decimals)} ${unit}. The table below lists every value.`}
            onPointerMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const px = event.clientX - box.left;
              let best = 0;
              points.forEach((_, i) => {
                if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
              });
              setActive(best);
            }}
            onPointerLeave={() => setActive(null)}
          >
            {[min, (min + max) / 2, max].map((t) => (
              <g key={t}>
                <line x1={left} x2={width} y1={y(t)} y2={y(t)} className="stroke-border" />
                <text
                  x={left - 6}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-[var(--text-muted)] text-[11px]"
                >
                  {fmt(t, 0)}
                </text>
              </g>
            ))}
            <path
              d={path}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              className={STROKE[color]}
            />
            {points.map((p, i) => (
              <circle
                key={p.key}
                cx={x(i)}
                cy={y(p.value)}
                r={active === i ? 5 : 4}
                strokeWidth={2}
                className={cn(FILL[color], "stroke-[var(--surface)]")}
              />
            ))}
            {[0, points.length - 1]
              .filter((i, n, all) => all.indexOf(i) === n)
              .map((i) => (
                <text
                  key={i}
                  x={x(i)}
                  y={height - 6}
                  textAnchor={i === 0 ? "start" : "end"}
                  className="fill-[var(--text-muted)] text-[11px]"
                >
                  {points[i]!.label}
                </text>
              ))}
            {active !== null && (
              <line
                x1={x(active)}
                x2={x(active)}
                y1={top}
                y2={top + plotH}
                className="stroke-[var(--text-muted)]"
                strokeDasharray="3 3"
              />
            )}
          </svg>
        )}
        {hovered && active !== null && (
          <div
            role="presentation"
            className="border-border bg-surface shadow-raised text-caption pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border px-2.5 py-1.5 whitespace-nowrap"
            style={{ left: Math.min(Math.max(x(active), 60), Math.max(60, width - 60)), top: 0 }}
          >
            <p className="text-muted">{hovered.title}</p>
            <p className="tabular text-label">
              {fmt(hovered.value, decimals)} {unit}
            </p>
          </div>
        )}
      </div>
      <ChartTable
        caption={label}
        head={["", unit]}
        rows={points.map((p) => [p.title, fmt(p.value, decimals)])}
      />
    </figure>
  );
};
