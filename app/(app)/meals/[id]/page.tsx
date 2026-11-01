import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MealView } from "@/components/meal/meal-view";
import { requireUser } from "@/lib/auth/session";
import { getMeal } from "@/lib/meals/service";
import { getTargets } from "@/lib/targets/service";
import { viewerToday } from "@/lib/ui/viewer-time";

export const metadata: Metadata = { title: "Meal" };

export default async function MealPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const [meal, { targets }, today] = await Promise.all([
    getMeal(user.id, (await params).id),
    getTargets(user.id),
    viewerToday(user.timeZone),
  ]);
  if (!meal) notFound();
  return (
    <MealView
      initial={meal}
      targets={targets}
      units={user.units === "imperial" ? "imperial" : "metric"}
      today={today}
    />
  );
}
