import Link from "next/link";

import { Card } from "@/components/ui/card";
import type { MoveDayViewDto } from "@/lib/contracts/move";
import {
  kalWorkoutsText,
  noTotalsNote,
  stepsFromLine,
  totalsSourceLine,
  type Segment,
} from "@/lib/move/words";

import { GoalRing } from "./goal-ring";

const Fact = ({ term, value, testId }: { term: string; value: string; testId: string }) => (
  <div data-testid={testId} className="min-w-0">
    <dt className="text-caption text-muted">{term}</dt>
    <dd className="tabular text-sm leading-snug font-bold">{value}</dd>
  </div>
);

const Sentence = ({ parts }: { parts: Segment[] }) =>
  parts.map((part, i) =>
    part.bold ? (
      <b key={i} className="text-text">
        {part.text}
      </b>
    ) : (
      <span key={i}>{part.text}</span>
    ),
  );

/**
 * The shown day on Move (board 39): steps, active time and activity calories in three rings
 * against their goals, as the phone counts them (Kal for Android 1.2); where they came from and
 * when the phone last sent; then Kal's own workouts and the day's points. A day without the
 * phone's numbers shows Move's steps and says how to get the other two.
 */
export const DayCard = ({
  day,
  updated,
}: {
  day: MoveDayViewDto;
  /** When a phone last sent ("23:04", "yesterday 21:05"); null when none has. */
  updated: string | null;
}) => {
  const t = day.totals;
  const steps = t?.steps ?? day.steps;
  const note = t ? null : noTotalsNote(day.phone);
  const line = stepsFromLine(day, updated);
  return (
    <Card as="section" aria-label="The day" className="flex flex-col gap-3" data-testid="move-day">
      <div className="flex gap-2">
        <GoalRing kind="steps" value={steps} goal={day.goals.steps} />
        <GoalRing
          kind="activeMinutes"
          value={t?.activeMinutes ?? null}
          goal={day.goals.activeMinutes}
        />
        <GoalRing kind="activeKcal" value={t?.activeKcal ?? null} goal={day.goals.activeKcal} />
      </div>
      <p className="text-caption text-muted leading-[1.45]" data-testid="move-day-source">
        {t ? (
          <Sentence parts={totalsSourceLine(t, updated)} />
        ) : (
          <>
            {line.before}
            {line.name && <b className="text-text">{line.name}</b>}
            {line.after}
          </>
        )}
      </p>
      {note && (
        <p className="text-caption text-muted leading-[1.45]" data-testid="move-day-no-totals">
          {note.text}{" "}
          {note.link && (
            <Link
              href="/more/android"
              className="text-primary font-semibold underline underline-offset-2"
            >
              {note.link}
            </Link>
          )}
        </p>
      )}
      <dl className="border-border grid grid-cols-2 gap-x-3 gap-y-1.5 border-t pt-2.5">
        <Fact term="Workouts in Kal" value={kalWorkoutsText(day)} testId="move-day-workouts" />
        <Fact
          term="Points"
          value={`+${day.points.toLocaleString("en-US")}`}
          testId="move-day-points"
        />
      </dl>
    </Card>
  );
};
