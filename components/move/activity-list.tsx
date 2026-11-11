"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import {
  ACTIVITY_CATEGORY_LABELS,
  formatMinutes,
  formatSteps,
  INTENSITY_LABELS,
  sourceLabel,
  type ActivityDto,
} from "@/lib/contracts/activities";
import { dayTitle } from "@/lib/ui/format";

import { CategoryIcon } from "./category-icon";

/** "Today 07:30 · Strength · from openGym" (steps have no time). */
export const activityCaption = (activity: ActivityDto, today: string) => {
  const day = dayTitle(activity.localDate, today);
  const when =
    activity.steps !== null && activity.durationMin === null ? day : `${day} ${activity.localTime}`;
  const from =
    activity.source === "manual"
      ? null
      : activity.source === "import"
        ? `imported from ${sourceLabel(activity.source, activity.sourceApp)}`
        : `from ${sourceLabel(activity.source, activity.sourceApp)}`;
  return [when, ACTIVITY_CATEGORY_LABELS[activity.category], from].filter(Boolean).join(" · ");
};

const estimateText = (activity: ActivityDto) =>
  activity.energyKcal === null
    ? null
    : activity.source === "import"
      ? `${Math.round(activity.energyKcal).toLocaleString("en-US")} kcal`
      : `~${Math.round(activity.energyKcal).toLocaleString("en-US")} kcal`;

/** The activities, newest first; a tap opens the details with Remove. */
export const ActivityList = ({
  activities,
  today,
}: {
  activities: ActivityDto[];
  today: string;
}) => {
  const router = useRouter();
  const { show } = useToast();
  const [open, setOpen] = useState<ActivityDto | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async (activity: ActivityDto) => {
    setBusy(true);
    try {
      await api.deleteActivity(activity.id);
      setOpen(null);
      show({ title: `${activity.title} removed`, tone: "success" });
      router.refresh();
    } catch (error) {
      show({ title: "Not removed", body: (error as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ul className="flex flex-col gap-2" data-testid="activity-list">
        {activities.map((activity) => {
          const steps = activity.durationMin === null && activity.steps !== null;
          const energy = estimateText(activity);
          return (
            <li key={activity.id}>
              <button
                type="button"
                onClick={() => setOpen(activity)}
                aria-haspopup="dialog"
                className="border-border bg-surface hover:bg-surface-2/60 flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left"
                data-testid="activity"
              >
                <CategoryIcon category={activity.category} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.9375rem] font-semibold wrap-break-word" dir="auto">
                    {activity.title}
                  </span>
                  <span className="text-caption text-muted block">
                    {activityCaption(activity, today)}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm">
                  <b className="tabular block">
                    {steps
                      ? formatSteps(activity.steps!)
                      : formatMinutes(activity.durationMin ?? 0)}
                  </b>
                  <span className="text-muted block">{steps ? "steps" : (energy ?? "")}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <BottomSheet
        open={open !== null}
        onOpenChange={(next) => !next && setOpen(null)}
        title={open?.title ?? "Activity"}
        description={open ? activityCaption(open, today) : undefined}
        footer={
          open && open.source !== "opengym" ? (
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              loading={busy}
              onClick={() => void remove(open)}
            >
              <Trash2 aria-hidden className="size-5" /> Remove
            </Button>
          ) : undefined
        }
      >
        {open && (
          <div className="py-1">
            <dl className="text-body grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
              {open.durationMin !== null && (
                <>
                  <dt className="text-muted">Time</dt>
                  <dd>{formatMinutes(open.durationMin)}</dd>
                </>
              )}
              {open.intensity && open.durationMin !== null && (
                <>
                  <dt className="text-muted">Effort</dt>
                  <dd>{INTENSITY_LABELS[open.intensity]}</dd>
                </>
              )}
              {open.steps !== null && (
                <>
                  <dt className="text-muted">Steps</dt>
                  <dd>{formatSteps(open.steps)}</dd>
                </>
              )}
              {open.distanceM !== null && (
                <>
                  <dt className="text-muted">Distance</dt>
                  <dd>{(open.distanceM / 1000).toFixed(2)} km</dd>
                </>
              )}
              {open.energyKcal !== null && (
                <>
                  <dt className="text-muted">Energy</dt>
                  <dd>
                    {Math.round(open.energyKcal).toLocaleString("en-US")} kcal
                    {open.source === "import"
                      ? ` (from ${sourceLabel(open.source, open.sourceApp)})`
                      : " (an estimate)"}
                  </dd>
                </>
              )}
              {open.notes && (
                <>
                  <dt className="text-muted">Notes</dt>
                  <dd dir="auto" className="wrap-break-word">
                    {open.notes}
                  </dd>
                </>
              )}
            </dl>
            {open.source === "opengym" && (
              <p className="text-caption text-muted mt-3">
                This workout comes from openGym. Change or remove it there; Kal follows at the next
                sync.
              </p>
            )}
          </div>
        )}
      </BottomSheet>
    </>
  );
};
