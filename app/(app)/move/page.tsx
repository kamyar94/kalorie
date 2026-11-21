import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { BadgesSection, LevelCard, WeekCard } from "@/components/move/move-summary";
import { MoveView, type OpenGymState } from "@/components/move/move-view";
import { DaySwipe } from "@/components/today/day-swipe";
import { dismissedHints } from "@/lib/account/hints";
import { androidConfig } from "@/lib/android/config";
import { listActivities } from "@/lib/activities/service";
import { requireUser } from "@/lib/auth/session";
import { bodyWeightOn } from "@/lib/body/weight";
import { lastUpdateAt, stepsOnlyFromPhone } from "@/lib/health-connect/log";
import { updatedWords } from "@/lib/health-connect/summary";
import { getIntegrationStatuses } from "@/lib/integrations/day";
import { openGymData } from "@/lib/integrations/opengym/service";
import { isLocalDate, shiftLocalDate } from "@/lib/meals/time";
import { getEveryDayMonth, getMoveDayView, getMoveSummary } from "@/lib/move/service";
import { moveHref, weekLabel, weekStart } from "@/lib/move/week";
import { isStale, moveDayTitle } from "@/lib/move/words";
import { viewerTimeZone, viewerToday } from "@/lib/ui/viewer-time";

export const metadata: Metadata = { title: "Move" };

/** How far back the folded list of activities goes. */
const LIST_DAYS = 42;

const arrowClass =
  "hover:bg-surface-2 grid size-11 shrink-0 place-items-center rounded-full transition-colors";

/**
 * Move for one day (`?date=YYYY-MM-DD`, today without it; days to come show today): the day
 * pager with the same swipe as Today, the week strip and the day with the phone's three numbers
 * (boards 36 and 39), every day of its month (board 40), then the level, the day's week and the
 * badges (board 10).
 */
export default async function MovePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const user = await requireUser();
  const today = await viewerToday(user.timeZone);
  const raw = (await searchParams).date;
  const requested = Array.isArray(raw) ? raw[0] : raw;
  const date = isLocalDate(requested) && requested <= today ? requested : today;
  // A sync older than 10 minutes is read again first, so new openGym workouts show.
  await openGymData(user.id).catch(() => null);
  const [day, recent, statuses, weightKg, summary, lastUpdate, zone, phoneOnly, closed, everyDay] =
    await Promise.all([
      getMoveDayView(user.id, date, today),
      listActivities(user.id, { from: shiftLocalDate(today, -LIST_DAYS), to: today, limit: 200 }),
      getIntegrationStatuses(user.id),
      bodyWeightOn(user.id, today),
      getMoveSummary(user.id, today, undefined, date),
      lastUpdateAt(user.id),
      viewerTimeZone(user.timeZone),
      stepsOnlyFromPhone(user.id),
      dismissedHints(user.id),
      getEveryDayMonth(user.id, date.slice(0, 7), today),
    ]);
  const gym = statuses.find((s) => s.kind === "opengym");
  const openGym: OpenGymState = !gym?.available
    ? "unavailable"
    : gym.connected
      ? "paired"
      : "unpaired";
  const monday = weekStart(date);
  const thisWeek = monday === weekStart(today);
  const prevHref = moveHref(shiftLocalDate(date, -1), today);
  const nextHref = date < today ? moveHref(shiftLocalDate(date, 1), today) : null;

  return (
    <DaySwipe prevHref={prevHref} nextHref={nextHref}>
      <header className="flex items-center gap-1">
        <Link href={prevHref} aria-label="Previous day" className={`${arrowClass} -ml-2`}>
          <ChevronLeft aria-hidden className="size-6" />
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="text-title">Move</h1>
          <p className="text-caption text-muted" data-testid="move-date">
            {moveDayTitle(date, today)}
          </p>
        </div>
        {nextHref ? (
          <Link href={nextHref} aria-label="Next day" className={`${arrowClass} -mr-2`}>
            <ChevronRight aria-hidden className="size-6" />
          </Link>
        ) : (
          <span aria-hidden className="size-11" />
        )}
      </header>
      <MoveView
        day={day}
        today={today}
        weekLabel={`Week of ${weekLabel(monday)}`}
        recent={recent}
        weightKg={weightKg}
        openGym={openGym}
        hint={phoneOnly && !closed.includes("phone-steps-only")}
        updated={lastUpdate ? updatedWords(lastUpdate, zone, today) : null}
        stale={isStale({ lastUpdate, date, today, zone })}
        appId={androidConfig().appId}
        everyDay={everyDay}
      >
        <LevelCard summary={summary} />
        <WeekCard
          summary={summary}
          title={thisWeek ? "This week by category" : `${weekLabel(monday)} by category`}
        />
        <BadgesSection badges={summary.badges} />
      </MoveView>
    </DaySwipe>
  );
}
