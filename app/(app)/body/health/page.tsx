import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HealthView } from "@/components/body/health-view";
import { getPreferences } from "@/lib/account/settings";
import { requireUser } from "@/lib/auth/session";
import { getHealthProfile } from "@/lib/body/health";
import { listMedicines } from "@/lib/medicines/service";

export const metadata: Metadata = { title: "Health profile" };

export default async function HealthPage() {
  const user = await requireUser();
  const [profile, preferences, medicines] = await Promise.all([
    getHealthProfile(user.id),
    getPreferences(user.id),
    listMedicines(user.id),
  ]);
  if (!profile) notFound();
  return (
    <HealthView
      initial={profile}
      units={preferences?.units ?? "metric"}
      medicinesInUse={medicines.filter((m) => !m.archived).length}
    />
  );
}
