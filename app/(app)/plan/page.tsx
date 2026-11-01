import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PlanView } from "@/components/plan/plan-view";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getIntegrationStatuses } from "@/lib/integrations/store";
import { getTargets } from "@/lib/targets/service";
import { viewerToday } from "@/lib/ui/viewer-time";

export const metadata: Metadata = { title: "Plan meals" };

/** Meal plan suggestions from Mealie recipes (docs/DESIGN.md section 8). */
export default async function PlanPage() {
  const user = await requireUser();
  const [statuses, today, { targets }] = await Promise.all([
    getIntegrationStatuses(user.id),
    viewerToday(user.timeZone),
    getTargets(user.id),
  ]);
  const mealie = statuses.find((s) => s.kind === "mealie");
  return (
    <>
      <h1 className="text-title">Plan meals</h1>
      {mealie?.connected ? (
        <PlanView
          today={today}
          energyTarget={targets.energy?.target ?? null}
          proteinTarget={targets.protein?.target ?? null}
        />
      ) : (
        <Card className="mt-4 flex flex-col items-start gap-3">
          <p className="text-body">
            Meal plan suggestions use your Mealie recipes. Connect Mealie in Settings first.
          </p>
          <Button asChild variant="secondary">
            <Link href="/settings#integrations">
              <CalendarDays aria-hidden className="size-4" /> Open connected apps
            </Link>
          </Button>
        </Card>
      )}
    </>
  );
}
