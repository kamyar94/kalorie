import type { Metadata } from "next";

import { MeasureView } from "@/components/body/measure-view";
import { getPreferences } from "@/lib/account/settings";
import { requireUser } from "@/lib/auth/session";
import { getBodySummary } from "@/lib/body/service";
import { CUSTOM_PREFIX } from "@/lib/contracts/body";
import { viewerToday } from "@/lib/ui/viewer-time";

export const metadata: Metadata = { title: "Log measurements" };

export default async function MeasurePage() {
  const user = await requireUser();
  const today = await viewerToday(user.timeZone);
  const [summary, preferences] = await Promise.all([
    getBodySummary(user.id, today),
    getPreferences(user.id),
  ]);
  const stored = summary.stats.filter((s) => s.group !== "ratio");
  return (
    <MeasureView
      today={today}
      units={preferences?.units ?? "metric"}
      last={Object.fromEntries(stored.map((s) => [s.code, s.value]))}
      customParts={stored
        .filter((s) => s.code.startsWith(CUSTOM_PREFIX))
        .map((s) => ({ label: s.label, unit: s.unit }))}
    />
  );
}
