import type { Metadata } from "next";

import { MedicinesView } from "@/components/medicines/medicines-view";
import { requireUser } from "@/lib/auth/session";
import { listMedicines, medicineHistory } from "@/lib/medicines/service";
import { viewerToday } from "@/lib/ui/viewer-time";

export const metadata: Metadata = { title: "Medicines" };

export default async function MedicinesPage() {
  const user = await requireUser();
  const today = await viewerToday(user.timeZone);
  const [medicines, history] = await Promise.all([
    listMedicines(user.id),
    medicineHistory(user.id, today, 90),
  ]);
  return <MedicinesView medicines={medicines} history={history} today={today} />;
}
