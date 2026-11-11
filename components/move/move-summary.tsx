import {
  Droplet,
  Dumbbell,
  Flame,
  Footprints,
  HeartPulse,
  Lock,
  Medal,
  Trophy,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { ACTIVITY_CATEGORY_LABELS } from "@/lib/contracts/activities";
import type { BadgeDto, BadgeIcon, MoveSummaryDto, WeekRowDto } from "@/lib/contracts/move";
import { shortDate } from "@/lib/ui/format";

import { CATEGORY_COLOR } from "./category-icon";

const n = (value: number) => value.toLocaleString("en-US");

/** Level, points and the streak (board 10, first card). */
export const LevelCard = ({ summary }: { summary: MoveSummaryDto }) => {
  const { points, streak } = summary;
  const next = points.level + 1;
  const percent = Math.min(100, (points.total / points.nextLevelAt) * 100);
  return (
    <Card as="section" aria-label="Level and streak" className="flex flex-col gap-2.5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="bg-primary-soft text-on-primary-soft grid size-13 shrink-0 place-items-center rounded-full text-xl font-extrabold"
        >
          {points.level}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-bold" data-testid="move-level">
            Level {points.level} · {n(points.total)} points
          </p>
          <p className="text-caption text-muted">
            {n(points.nextLevelAt - points.total)} points to level {next}
          </p>
        </div>
        <p className="flex shrink-0 flex-col items-center text-center" data-testid="move-streak">
          <Flame aria-hidden className="text-energy size-5.5" />
          <span className="text-caption font-bold">
            {streak.days ? `${streak.days}-day streak` : "No streak yet"}
          </span>
        </p>
      </div>
      <div
        role="progressbar"
        aria-label={`Progress to level ${next}`}
        aria-valuemin={0}
        aria-valuemax={points.nextLevelAt}
        aria-valuenow={points.total}
        aria-valuetext={`${n(points.total)} of ${n(points.nextLevelAt)} points`}
        className="bg-surface-2 h-2 overflow-hidden rounded-full"
      >
        <div className="bg-primary h-full rounded-full" style={{ width: `${percent}%` }} />
      </div>
      {!streak.activeToday && streak.days > 0 && (
        <p className="text-caption text-muted">
          20 active minutes or 5,000 steps today keep the streak going.
        </p>
      )}
    </Card>
  );
};

const rowText = (row: WeekRowDto) => {
  if (row.unit === "steps")
    return row.target ? `${n(row.value)} of ${n(row.target)} steps` : `${n(row.value)} steps`;
  if (row.unit === "days") {
    const sessions = `${row.value} of ${row.target} days`;
    return row.target && row.value >= row.target ? `${sessions} · done` : sessions;
  }
  if (!row.value) return "none yet";
  if (!row.target) return `${n(row.value)} min`;
  const text = `${n(row.value)} of ${n(row.target)} min`;
  return row.value >= row.target ? `${text} · done` : text;
};

/** This week by category against the targets (board 10, second card). */
export const WeekCard = ({ summary }: { summary: MoveSummaryDto }) => (
  <Card as="section" aria-labelledby="week-heading" className="flex flex-col gap-3">
    <h2 id="week-heading" className="text-body font-semibold">
      This week by category
    </h2>
    <ul className="flex flex-col gap-3" data-testid="week-rows">
      {summary.week.rows.map((row) => {
        const percent = row.target ? Math.min(100, (row.value / row.target) * 100) : 0;
        return (
          <li key={row.category} className="flex flex-col gap-1">
            <div className="flex justify-between gap-3 text-sm">
              <span className="font-semibold">{ACTIVITY_CATEGORY_LABELS[row.category]}</span>
              <span className="tabular text-right">{rowText(row)}</span>
            </div>
            <div aria-hidden className="bg-surface-2 h-2 overflow-hidden rounded-full">
              {percent > 0 && (
                <div
                  className={cn("h-full rounded-full", CATEGORY_COLOR[row.category].bar)}
                  style={{ width: `${percent}%` }}
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
    <p className="text-caption text-muted">
      Weekly targets follow the WHO guidance: 150 min of moderate activity and strength on 2 days.
      Walks and sports count as cardio; a vigorous minute counts twice. Steps and mobility are
      Kal&apos;s own targets.
    </p>
  </Card>
);

const BADGE_ICONS: Record<BadgeIcon, { icon: typeof Medal; color: string }> = {
  medal: { icon: Medal, color: "text-carbs" },
  flame: { icon: Flame, color: "text-energy" },
  steps: { icon: Footprints, color: "text-fiber" },
  heart: { icon: HeartPulse, color: "text-energy" },
  dumbbell: { icon: Dumbbell, color: "text-protein" },
  water: { icon: Droplet, color: "text-water" },
  trophy: { icon: Trophy, color: "text-carbs" },
};

const BadgeTile = ({ badge }: { badge: BadgeDto }) => {
  const earned = badge.earnedOn !== null;
  const { icon: Icon, color } = BADGE_ICONS[badge.icon];
  return (
    <li
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-2xl px-1 py-2.5 text-center",
        earned
          ? "border-border bg-surface border"
          : "border-border text-muted border border-dashed",
      )}
      data-badge={badge.code}
      data-earned={earned}
    >
      {earned ? (
        <Icon aria-hidden className={cn("size-7.5", color)} />
      ) : (
        <Lock aria-hidden className="size-7.5" />
      )}
      <span className="text-caption leading-tight font-semibold">{badge.label}</span>
      <span className="sr-only">
        {earned ? `, earned ${shortDate(badge.earnedOn!)}` : `, locked: ${badge.condition}`}
      </span>
      {!earned && <span className="text-[0.6875rem] leading-tight">{badge.condition}</span>}
    </li>
  );
};

/** Earned badges first, then the locked ones dimmed with their condition (board 10). */
export const BadgesSection = ({ badges }: { badges: BadgeDto[] }) => {
  const earned = badges.filter((b) => b.earnedOn !== null);
  const locked = badges.filter((b) => b.earnedOn === null);
  return (
    <section aria-labelledby="badges-heading" className="flex flex-col gap-2">
      <h2 id="badges-heading" className="text-body font-semibold">
        Badges{" "}
        <span className="text-muted font-normal">
          · {earned.length} of {badges.length}
        </span>
      </h2>
      <ul className="grid grid-cols-3 gap-2 min-[400px]:grid-cols-4" data-testid="badges">
        {[...earned, ...locked].map((badge) => (
          <BadgeTile key={badge.code} badge={badge} />
        ))}
      </ul>
    </section>
  );
};
