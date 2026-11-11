import Link from "next/link";

import { Card } from "@/components/ui/card";
import { formatMinutes, formatSteps } from "@/lib/contracts/activities";
import type { MoveDayDto } from "@/lib/contracts/move";

const Tile = ({ value, caption, testId }: { value: string; caption: string; testId: string }) => (
  <div className="bg-bg min-w-0 rounded-[0.875rem] p-2.5" data-testid={testId}>
    <p className="tabular text-xl leading-tight font-bold">{value}</p>
    <p className="text-caption text-muted wrap-break-word">{caption}</p>
  </div>
);

/**
 * Today's Move card (board 9): active minutes with what they were, the day's steps, and the
 * points of the day; Details opens Move.
 */
export const MoveCard = ({ day, isToday }: { day: MoveDayDto; isToday: boolean }) => (
  <Card
    as="section"
    aria-labelledby="move-heading"
    className="flex flex-col gap-3"
    data-testid="move-card"
  >
    <div className="flex items-center justify-between gap-2">
      <h2 id="move-heading" className="text-body font-semibold">
        Move
      </h2>
      <Link
        href="/move"
        className="text-label text-primary -mr-2 inline-flex min-h-11 items-center rounded-full px-2"
      >
        Details
      </Link>
    </div>
    <div className="grid grid-cols-3 gap-2">
      <Tile
        testId="move-minutes"
        value={formatMinutes(day.activeMinutes)}
        caption={day.activeLabel ?? "Active"}
      />
      <Tile
        testId="move-steps"
        value={formatSteps(day.steps)}
        caption={day.stepsSource ? `Steps, ${day.stepsSource}` : "Steps"}
      />
      <Tile
        testId="move-points"
        value={`+${day.points.toLocaleString("en-US")}`}
        caption={isToday ? "Points today" : "Points"}
      />
    </div>
  </Card>
);
