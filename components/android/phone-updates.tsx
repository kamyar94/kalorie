// A linked phone's Health Connect state on "Kal for Android" (board 34): the "Nothing has arrived
// yet" warning with "How to fix it", and "Recent updates", the latest updates the phone sent with
// what each brought. The words come from lib/health-connect/summary.ts; times are worded on the
// server in the viewer's zone.
import { cn } from "@/components/ui/cn";
import { UPDATE_LOG_DAYS } from "@/lib/contracts/health-connect";
import {
  nothingArrivedText,
  type SummaryTone,
  type UpdateSummary,
} from "@/lib/health-connect/summary";

export type PhoneUpdate = { id: string; when: string; summary: UpdateSummary };

/** Samsung Health's menu button as its icon looks. */
const Menu = () => (
  <span role="img" aria-label="the menu">
    ⋮
  </span>
);

/** Where Move's hint and the page's own "How to fix it" lead (`/more/android#how-to-fix`). */
export const HOW_TO_FIX_ID = "how-to-fix";

/** The five steps that get Samsung Health and Renpho sharing with Health Connect (board 34). */
export const FixSteps = () => (
  <ol className="flex list-decimal flex-col gap-1.5 pl-5">
    <li>
      Samsung Health: <Menu />, Settings, Data management, Health Connect. Turn sharing on and tick
      Steps, Exercise, Heart rate, Sleep, Weight.
    </li>
    <li>
      Phone Settings, Health Connect, App permissions: Samsung Health may write; Kal may read, also
      in the background.
    </li>
    <li>Renpho Health: Me, Apps, Health Connect, all permissions on.</li>
    <li>Settings, Apps, Samsung Health, Battery: Unrestricted.</li>
    <li>Open Kal&apos;s Health Connect screen and tap Send now.</li>
  </ol>
);

/**
 * Shown while the phone has sent updates and no Health Connect record of the person is stored.
 * `fixId` names its "How to fix it" (the first warning on the page carries HOW_TO_FIX_ID).
 */
export const NothingArrived = ({ updates, fixId }: { updates: number; fixId?: string }) => (
  <div
    role="status"
    className="bg-warning-soft border-on-warning-soft/40 flex flex-col gap-2 rounded-2xl border px-3.5 py-3"
    data-testid="android-nothing-arrived"
  >
    <h3 className="text-on-warning-soft text-[0.9375rem] leading-snug font-bold">
      Nothing has arrived yet
    </h3>
    <p className="text-sm leading-[1.45]">{nothingArrivedText(updates)}</p>
    <details open id={fixId} className="scroll-mt-4 text-sm leading-[1.45]">
      <summary className="text-on-warning-soft cursor-pointer py-3 font-semibold">
        How to fix it
      </summary>
      <FixSteps />
    </details>
  </div>
);

const TONE: Record<SummaryTone, string> = {
  content: "text-text",
  nothing: "text-muted",
  "empty-read": "text-on-warning-soft",
};

const Summary = ({ summary }: { summary: UpdateSummary }) => (
  <span className={cn("min-w-0 flex-1 text-sm", TONE[summary.tone])}>
    {summary.lead}
    {summary.lead && summary.parts.length > 0 && " "}
    {summary.parts.map((part, index) => (
      <span key={index}>
        {index > 0 && " · "}
        {part.emoji && <span aria-hidden>{part.emoji} </span>}
        {part.text}
      </span>
    ))}
  </span>
);

/** The phone's latest updates, newest first, or what is known without any. */
export const RecentUpdates = ({
  updates,
  lastSent,
  warning,
}: {
  updates: PhoneUpdate[];
  lastSent: string | null;
  warning: boolean;
}) => (
  <div>
    <h3 className="text-label mb-1">Recent updates</h3>
    {updates.length > 0 ? (
      <ul className="flex flex-col" data-testid="android-updates">
        {updates.map((update) => (
          <li
            key={update.id}
            className="border-border flex min-h-12 items-center gap-2.5 border-t py-1.5"
            data-testid="android-update"
          >
            <span className="text-caption text-muted w-24 shrink-0">{update.when}</span>
            <Summary summary={update.summary} />
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-caption text-muted" data-testid="android-updates-none">
        {lastSent
          ? `Last sent ${lastSent}. From the next update on, each one is listed here.`
          : "Nothing sent yet."}
      </p>
    )}
    <p className="text-caption text-muted mt-1.5">
      Kept for {UPDATE_LOG_DAYS} days.
      {warning ? " The warning above disappears once records arrive." : ""}
    </p>
  </div>
);
