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

import { ActivityList } from "./activity-list";
import { ActivitySheet } from "./activity-sheet";

export type OpenGymState = "unavailable" | "unpaired" | "paired";

/**
 * Move (board 10): "+ Activity", the activities of the last weeks, and where the data comes from
 * (openGym by itself, Samsung Health or a scale by an export file for now).
 */
export const MoveView = ({
  today,
  weekLabel,
  activities,
  weightKg,
  openGym,
  children,
}: {
  today: string;
  weekLabel: string;
  activities: ActivityDto[];
  weightKg: number | null;
  openGym: OpenGymState;
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
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title">Move</h1>
          <p className="text-caption text-muted">This week, {weekLabel}</p>
        </div>
        <Button
          className="shrink-0 rounded-full"
          aria-label="Add an activity"
          onClick={() => setAdding(Date.now())}
        >
          <Plus aria-hidden className="size-4" /> Activity
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
        <div className="flex flex-col gap-4">{children}</div>

        <div className="flex flex-col gap-4">
          <section aria-labelledby="activities-heading" className="flex flex-col gap-2">
            <h2 id="activities-heading" className="text-body font-semibold">
              Activities
            </h2>
            {activities.length ? (
              <ActivityList activities={activities} today={today} />
            ) : (
              <p className="text-body text-muted">
                Nothing in the last weeks yet. Add an activity, or bring in your data below.
              </p>
            )}
          </section>

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
        onSaved={(activity) => {
          setAdding(null);
          show({ title: `${activity.title} added`, tone: "success" });
          router.refresh();
        }}
      />
    </>
  );
};
