"use client";

import { FileUp, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import type { ActivityDto } from "@/lib/contracts/activities";
import type { MoveDayViewDto } from "@/lib/contracts/move";

import { ActivityList } from "./activity-list";
import { ActivitySheet } from "./activity-sheet";
import { DayCard } from "./day-card";
import { StepsHint } from "./steps-hint";
import { WeekStrip } from "./week-strip";

export type OpenGymState = "unavailable" | "unpaired" | "paired";

/**
 * Move for one day (boards 10 and 36): the week strip, the day's card, the hint about the phone's
 * step counter, the day's activities with "+ Activity on this day"; beside or below them the
 * level, the week and the badges, the last six weeks (folded) and where the data comes from.
 */
export const MoveView = ({
  day,
  today,
  weekLabel,
  recent,
  weightKg,
  openGym,
  hint,
  updated,
  children,
}: {
  day: MoveDayViewDto;
  today: string;
  /** "Week of 16 to 22 November". */
  weekLabel: string;
  /** The last six weeks, newest first. */
  recent: ActivityDto[];
  weightKg: number | null;
  openGym: OpenGymState;
  /** Show the hint that only the phone's own step counter sends steps. */
  hint: boolean;
  /** When a phone last sent, worded in the viewer's zone. */
  updated: string | null;
  /** The level, week and badges sections. */
  children?: React.ReactNode;
}) => {
  const router = useRouter();
  const { show } = useToast();
  const [adding, setAdding] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await api.syncOpenGym();
      show({
        title: "openGym read",
        body: `${result.workouts} workouts and ${result.weighIns} weigh-ins.`,
        tone: "success",
      });
      router.refresh();
    } catch (error) {
      show({ title: "openGym not read", body: (error as Error).message, tone: "error" });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
        <div className="flex flex-col gap-4">
          <WeekStrip
            days={day.week}
            selected={day.date}
            today={today}
            goal={day.stepGoal}
            label={weekLabel}
          />
          <DayCard day={day} updated={updated} />
          {hint && <StepsHint />}
          <Card
            as="section"
            aria-labelledby="day-activities-heading"
            className="flex flex-col gap-2"
          >
            <h2 id="day-activities-heading" className="text-body font-semibold">
              {day.date === today ? "Today" : "That day"}
            </h2>
            {day.activities.length ? (
              <ActivityList
                activities={day.activities}
                today={today}
                variant="day"
                testId="day-activities"
              />
            ) : (
              <p className="text-body text-muted">Nothing logged on this day.</p>
            )}
            <Button
              variant="ghost"
              className="border-primary text-primary mt-1 rounded-full border border-dashed"
              aria-label="Add an activity on this day"
              onClick={() => setAdding(Date.now())}
            >
              <Plus aria-hidden className="size-4" /> Activity on this day
            </Button>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {children}

          <details data-testid="move-recent">
            <summary className="text-body flex min-h-11 cursor-pointer items-center font-semibold">
              Last six weeks
              <span className="text-muted ml-1 font-normal">· {recent.length}</span>
            </summary>
            <div className="mt-2">
              {recent.length ? (
                <ActivityList activities={recent} today={today} />
              ) : (
                <p className="text-body text-muted">
                  Nothing in the last weeks yet. Add an activity, or bring in your data below.
                </p>
              )}
            </div>
          </details>

          <Card as="section" aria-labelledby="connect-heading" className="flex flex-col gap-2.5">
            <h2 id="connect-heading" className="text-body font-semibold">
              Bring in your data
            </h2>
            <p className="text-caption text-muted">
              {openGym === "unavailable"
                ? "From Samsung Health or your scale, import the export file for now."
                : "openGym workouts come in by themselves. From Samsung Health or your scale, import the export file for now."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary" className="rounded-full">
                <Link href="/import?from=move">
                  <FileUp aria-hidden className="size-4" /> Import Samsung Health file
                </Link>
              </Button>
              {openGym === "paired" && (
                <Button
                  variant="secondary"
                  className="rounded-full"
                  loading={syncing}
                  onClick={() => void sync()}
                >
                  <RefreshCw aria-hidden className="size-4" /> Sync openGym
                </Button>
              )}
              {openGym === "unpaired" && (
                <Button asChild variant="secondary" className="rounded-full">
                  <Link href="/settings#integrations">Pair openGym in Settings</Link>
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>

      <ActivitySheet
        openedAt={adding}
        onOpenChange={(open) => !open && setAdding(null)}
        weightKg={weightKg}
        day={{ date: day.date, today }}
        onSaved={(activity) => {
          setAdding(null);
          show({ title: `${activity.title} added`, tone: "success" });
          router.refresh();
        }}
      />
    </>
  );
};
