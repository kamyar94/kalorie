import { Card } from "@/components/ui/card";
import { formatMinutes } from "@/lib/contracts/activities";
import type { MoveDayViewDto } from "@/lib/contracts/move";
import { stepsFromLine } from "@/lib/move/words";

import { StepsRing } from "./steps-ring";

const Fact = ({ term, value, testId }: { term: string; value: string; testId: string }) => (
  <div data-testid={testId}>
    <dt className="text-caption text-muted">{term}</dt>
    <dd className="tabular text-[1.0625rem] leading-snug font-bold">{value}</dd>
  </div>
);

/**
 * The shown day on Move (board 36): its steps in a ring against the step goal, active minutes,
 * energy from activity and points, and where the steps came from with when a phone last sent.
 */
export const DayCard = ({
  day,
  updated,
}: {
  day: MoveDayViewDto;
  /** When a phone last sent ("23:04", "yesterday 21:05"); null when none has. */
  updated: string | null;
}) => {
  const line = stepsFromLine(day, updated);
  return (
    <Card as="section" aria-label="The day" className="flex flex-col gap-3" data-testid="move-day">
      <div className="flex items-center gap-4">
        <StepsRing steps={day.steps} goal={day.stepGoal} />
        <dl className="grid min-w-0 flex-1 grid-cols-1 gap-2">
          <Fact
            term="Active minutes"
            value={formatMinutes(day.activeMinutes)}
            testId="move-day-minutes"
          />
          <Fact
            term="Energy from activity"
            value={day.energyKcal === null ? "–" : `${day.energyKcal.toLocaleString("en-US")} kcal`}
            testId="move-day-energy"
          />
          <Fact
            term="Points"
            value={`+${day.points.toLocaleString("en-US")}`}
            testId="move-day-points"
          />
        </dl>
      </div>
      <p className="text-caption text-muted" data-testid="move-day-source">
        {line.before}
        {line.name && <b className="text-text">{line.name}</b>}
        {line.after}
      </p>
    </Card>
  );
};
