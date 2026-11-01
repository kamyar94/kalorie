import type { Metadata } from "next";

import { AddView } from "@/components/add/add-view";
import { requireUser } from "@/lib/auth/session";
import { MEAL_SLOT_LABELS } from "@/lib/contracts/meals";
import { getMeal } from "@/lib/meals/service";
import { isLocalDate } from "@/lib/meals/time";
import { viewerToday } from "@/lib/ui/viewer-time";

export const metadata: Metadata = { title: "Add food" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function AddPage({
  searchParams,
}: {
  searchParams: Promise<{ meal?: string | string[]; date?: string | string[] }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const today = await viewerToday(user.timeZone);
  const mealParam = first(params.meal);
  const meal = mealParam ? await getMeal(user.id, mealParam) : null;
  const date = first(params.date);
  return (
    <AddView
      mealId={meal?.id ?? null}
      mealTitle={meal ? (meal.title ?? MEAL_SLOT_LABELS[meal.slot]) : null}
      date={isLocalDate(date) && date <= today ? date : null}
      today={today}
      units={user.units === "imperial" ? "imperial" : "metric"}
    />
  );
}
