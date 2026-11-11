import type { Metadata } from "next";

import { BodyPhotos } from "@/components/body/body-photos";
import { BodyView } from "@/components/body/body-view";
import { getPreferences } from "@/lib/account/settings";
import { requireUser } from "@/lib/auth/session";
import { listBodySessions } from "@/lib/body/photos";
import { getBodySummary } from "@/lib/body/service";
import { openGymData } from "@/lib/integrations/opengym/service";
import { isLocalDate } from "@/lib/meals/time";
import { viewerToday } from "@/lib/ui/viewer-time";

export const metadata: Metadata = { title: "Body" };

export default async function BodyPage({
  searchParams,
}: {
  searchParams: Promise<{ since?: string | string[] }>;
}) {
  const user = await requireUser();
  const today = await viewerToday(user.timeZone);
  const raw = (await searchParams).since;
  const since = Array.isArray(raw) ? raw[0] : raw;
  // New openGym weigh-ins first (a sync older than 10 minutes is read again).
  await openGymData(user.id).catch(() => null);
  const [summary, preferences, sessions] = await Promise.all([
    getBodySummary(user.id, today, isLocalDate(since) ? since : null),
    getPreferences(user.id),
    listBodySessions(user.id),
  ]);
  const units = preferences?.units ?? "metric";
  return (
    <BodyView
      summary={summary}
      units={units}
      today={today}
      photos={
        <BodyPhotos
          sessions={sessions}
          weights={summary.weightHistory}
          units={units}
          today={today}
        />
      }
    />
  );
}
