import type { Metadata } from "next";

import { MoveView, type OpenGymState } from "@/components/move/move-view";
import { listActivities } from "@/lib/activities/service";
import { requireUser } from "@/lib/auth/session";
import { bodyWeightOn } from "@/lib/body/weight";
import { getIntegrationStatuses } from "@/lib/integrations/day";
import { openGymData } from "@/lib/integrations/opengym/service";
import { shiftLocalDate } from "@/lib/meals/time";
import { weekLabel, weekStart } from "@/lib/move/week";
import { viewerToday } from "@/lib/ui/viewer-time";

export const metadata: Metadata = { title: "Move" };

/** How far back the activity list goes. */
const LIST_DAYS = 42;

export default async function MovePage() {
  const user = await requireUser();
  const today = await viewerToday(user.timeZone);
  // A sync older than 10 minutes is read again first, so new openGym workouts show.
  await openGymData(user.id).catch(() => null);
  const [activities, statuses, weightKg] = await Promise.all([
    listActivities(user.id, { from: shiftLocalDate(today, -LIST_DAYS), to: today, limit: 200 }),
    getIntegrationStatuses(user.id),
    bodyWeightOn(user.id, today),
  ]);
  const gym = statuses.find((s) => s.kind === "opengym");
  const openGym: OpenGymState = !gym?.available
    ? "unavailable"
    : gym.connected
      ? "paired"
      : "unpaired";
  return (
    <MoveView
      today={today}
      weekLabel={weekLabel(weekStart(today))}
      activities={activities}
      weightKg={weightKg}
      openGym={openGym}
    />
  );
}
