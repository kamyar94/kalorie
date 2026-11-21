import Link from "next/link";

import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import type { MoveDayDto } from "@/lib/contracts/move";
import { moveHref } from "@/lib/move/week";
import { todayTiles } from "@/lib/move/words";

const TILE = "bg-bg block min-w-0 rounded-[0.875rem] p-2.5";

const TileText = ({ value, caption }: { value: string; caption: string }) => (
  <>
    <span className="tabular block text-xl leading-tight font-bold">{value}</span>
    <span className="text-caption text-muted block wrap-break-word">{caption}</span>
  </>
);

const Tile = ({ value, caption, testId }: { value: string; caption: string; testId: string }) => (
  <div className={TILE} data-testid={testId}>
    <TileText value={value} caption={caption} />
  </div>
);

/**
 * Today's Move card (board 9 with board 39's numbers): the day's steps with where they came from
 * (and when a phone last sent, for Health Connect's), active time and activity calories, the
 * phone's when Kal for Android 1.2 sent them (else Kal's active minutes with what they were and
 * the energy of Kal's activities), and the points of the day. The steps and Details open Move for
 * the same day.
 */
export const MoveCard = ({
  day,
  date,
  today,
  updated = null,
}: {
  day: MoveDayDto;
  date: string;
  today: string;
  /** When a phone last sent ("23:04"), worded in the viewer's zone; null to leave it out. */
  updated?: string | null;
}) => {
  const tiles = todayTiles(day, updated);
  return (
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
          href={moveHref(date, today)}
          className="text-label text-primary -mr-2 inline-flex min-h-11 items-center rounded-full px-2"
        >
          Details
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Link
          href={moveHref(date, today)}
          className={cn(TILE, "hover:bg-surface-2 transition-colors")}
          data-testid="move-steps"
        >
          <TileText value={tiles.steps.value} caption={tiles.steps.caption} />
        </Link>
        <Tile testId="move-minutes" value={tiles.active.value} caption={tiles.active.caption} />
        <Tile testId="move-kcal" value={tiles.kcal.value} caption={tiles.kcal.caption} />
      </div>
      <p className="text-caption text-muted" data-testid="move-points">
        <b className="text-text tabular">+{day.points.toLocaleString("en-US")}</b>{" "}
        {date === today ? "points today" : "points"}
      </p>
    </Card>
  );
};
