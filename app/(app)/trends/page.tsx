import type { Metadata } from "next";

import { TrendsView } from "@/components/trends/trends-view";
import { requireUser } from "@/lib/auth/session";
import { isLocalDate } from "@/lib/meals/time";
import { TREND_RANGES, type TrendRange } from "@/lib/trends/compute";
import { getTrends } from "@/lib/trends/service";
import { viewerToday } from "@/lib/ui/viewer-time";

export const metadata: Metadata = { title: "Trends" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[]; end?: string | string[] }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const today = await viewerToday(user.timeZone);
  const rangeParam = first(params.range);
  const range: TrendRange = TREND_RANGES.includes(rangeParam as TrendRange)
    ? (rangeParam as TrendRange)
    : "week";
  const endParam = first(params.end);
  const end = isLocalDate(endParam) && endParam <= today ? endParam : today;
  const data = await getTrends(user.id, range, end);
  return <TrendsView data={data} today={today} />;
}
