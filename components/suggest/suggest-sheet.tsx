"use client";

import { Pencil, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { MealThumb } from "@/components/balance/score-ring";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/client/api";
import type { MealIdeaDto, SuggestionDto, SuggestionsDto } from "@/lib/contracts/suggest";
import { deviceTimeZone } from "@/lib/photos/client";
import { formatKcal } from "@/lib/ui/format";

const grams = (value: number) => `${formatKcal(value)} g`;

/** Today's numbers still open (board 42's four tiles). */
const LeftTiles = ({ data }: { data: SuggestionsDto }) => {
  const { left } = data;
  const sodium = left.limits.find((l) => l.code === "sodium");
  const tiles: [string, string][] = [
    left.energyLeft >= 0
      ? [formatKcal(left.energyLeft), "kcal left"]
      : [formatKcal(-left.energyLeft), "kcal over"],
    ...(left.protein !== null ? [[grams(left.protein), "protein left"] as [string, string]] : []),
    ...(left.fiber !== null ? [[grams(left.fiber), "fiber left"] as [string, string]] : []),
    ...(sodium ? [[`${formatKcal(sodium.room)} mg`, "sodium room"] as [string, string]] : []),
  ];
  return (
    <dl
      className="bg-surface-2 grid grid-cols-4 gap-1.5 rounded-2xl p-2.5"
      aria-label="Left today"
      data-testid="suggest-left"
    >
      {tiles.map(([value, label]) => (
        <div key={label} className="flex min-w-0 flex-col-reverse">
          <dt className="text-muted text-[0.6875rem] leading-tight">{label}</dt>
          <dd className="tabular text-base leading-tight font-bold">{value}</dd>
        </div>
      ))}
    </dl>
  );
};

const Suggestion = ({
  item,
  first,
  busy,
  onLog,
  onDetails,
}: {
  item: SuggestionDto;
  first: boolean;
  busy: boolean;
  onLog: () => void;
  onDetails: () => void;
}) => (
  <li
    className={cn(
      "flex flex-col gap-2 rounded-2xl border p-3",
      first ? "border-primary" : "border-border",
    )}
    aria-labelledby={`suggest-${item.mealId}`}
  >
    <div className="flex items-center gap-2.5">
      <MealThumb photoUrl={item.photoUrl} foods={item.foods} />
      <span className="min-w-0 flex-1">
        <span id={`suggest-${item.mealId}`} className="text-body block font-semibold" dir="auto">
          {item.title}
        </span>
        <span className="text-caption text-muted tabular block">
          {formatKcal(item.energy)} kcal
        </span>
      </span>
      {item.badge && (
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-bold",
            first ? "bg-primary text-on-primary" : "bg-surface-2 text-text",
          )}
        >
          {item.badge}
        </span>
      )}
    </div>
    <p className="text-caption leading-snug">{item.reason}</p>
    <div className="flex gap-2">
      <Button
        variant={first ? "primary" : "secondary"}
        className="flex-1 rounded-full"
        loading={busy}
        onClick={onLog}
        aria-describedby={`suggest-${item.mealId}`}
      >
        Log this
      </Button>
      <Button
        variant="secondary"
        className="rounded-full px-4"
        onClick={onDetails}
        aria-describedby={`suggest-${item.mealId}`}
      >
        Details
      </Button>
    </div>
  </li>
);

/** "Something new (asks your AI)": one idea with rough nutrients and "Type it". */
const AiIdea = ({ onTypeIt }: { onTypeIt: (text: string) => void }) => {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "asking" }
    | { kind: "done"; idea: MealIdeaDto }
    | { kind: "error"; message: string; settings: boolean }
  >({ kind: "idle" });

  const ask = async () => {
    setState({ kind: "asking" });
    try {
      setState({ kind: "done", idea: await api.mealIdea(deviceTimeZone()) });
    } catch (error) {
      setState({
        kind: "error",
        message: (error as Error).message,
        // 409: the fix is in the AI settings (no key, a refused key, no credit).
        settings: error instanceof ApiError && error.status === 409,
      });
    }
  };

  if (state.kind === "done") {
    const { idea } = state;
    return (
      <section
        aria-labelledby="idea-heading"
        className="border-primary flex flex-col gap-2 rounded-2xl border border-dashed p-3"
        data-testid="suggest-idea"
      >
        <h3 id="idea-heading" className="text-body inline-flex items-center gap-1.5 font-semibold">
          <Sparkles aria-hidden className="text-primary size-4 shrink-0" />
          <span dir="auto">{idea.name}</span>
        </h3>
        <p className="text-caption leading-snug" dir="auto">
          {idea.description}
        </p>
        <p className="text-caption text-muted tabular">
          Roughly {formatKcal(idea.energy)} kcal · {idea.protein} g protein · {idea.fiber} g fiber ·{" "}
          {formatKcal(idea.sodium)} mg sodium (the AI&apos;s estimate)
        </p>
        <div className="flex gap-2">
          <Button className="flex-1 rounded-full" onClick={() => onTypeIt(idea.description)}>
            <Pencil aria-hidden className="size-4" /> Type it
          </Button>
          <Button variant="secondary" className="rounded-full px-4" onClick={() => void ask()}>
            Another
          </Button>
        </div>
      </section>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void ask()}
        disabled={state.kind === "asking"}
        aria-busy={state.kind === "asking" || undefined}
        className="border-primary text-primary hover:bg-primary-soft inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-dashed px-4 text-sm font-semibold disabled:opacity-60"
      >
        <Sparkles aria-hidden className="size-4" />
        {state.kind === "asking" ? "Asking your AI…" : "Something new (asks your AI)"}
      </button>
      {state.kind === "error" && (
        <p role="alert" className="text-caption text-danger">
          {state.message}{" "}
          {state.settings && (
            <Link
              href="/settings#ai"
              className="text-primary inline-flex items-center gap-1 underline"
            >
              <Settings aria-hidden className="size-3.5" /> AI settings
            </Link>
          )}
        </p>
      )}
    </div>
  );
};

/**
 * "What should I eat?" (board 42): for now, what is left today against the targets, the person's
 * usual meal at this hour, and the three meals they have had that fit best, each with Log this
 * (a copy at now, like a favorite, with Undo) and Details; "Something new" asks their own AI when
 * a key is saved. Opened from the top of Today and from the camera (above it, `elevated`).
 */
export const SuggestSheet = ({
  open,
  onOpenChange,
  elevated = false,
  onLogged,
  onDetails,
  onTypeIt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  elevated?: boolean;
  /** A suggestion was logged (and the sheet closed): refresh, or go to Today. */
  onLogged: (copyId: string) => void;
  /** Open the past meal. */
  onDetails: (mealId: string) => void;
  /** The AI's idea goes into a text meal. */
  onTypeIt: (text: string) => void;
}) => {
  const router = useRouter();
  const { show } = useToast();
  const [data, setData] = useState<SuggestionsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Each opening asks again: "now" and what is left change through the day.
  const [asked, setAsked] = useState({ open, attempt });
  if (asked.open !== open || asked.attempt !== attempt) {
    setAsked({ open, attempt });
    if (open) {
      setData(null);
      setError(null);
    }
  }
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    api
      .suggestions(deviceTimeZone(), controller.signal)
      .then(setData)
      .catch((caught: Error) => {
        if (caught.name !== "AbortError") setError(caught.message);
      });
    return () => controller.abort();
  }, [open, attempt]);

  const log = useCallback(
    async (item: SuggestionDto) => {
      const when = { eatenAt: new Date().toISOString(), tz: deviceTimeZone() };
      setBusy(item.mealId);
      try {
        const copy = item.favorite
          ? await api.logFavorite(item.mealId, when)
          : await api.duplicateMeal(item.mealId, when);
        onOpenChange(false);
        onLogged(copy.id);
        show({
          title: `${item.title} logged`,
          tone: "success",
          action: {
            label: "Undo",
            onClick: () =>
              void api
                .deleteMeal(copy.id)
                .then(() => router.refresh())
                .catch((caught) =>
                  show({ title: "Not undone", body: (caught as Error).message, tone: "error" }),
                ),
          },
        });
      } catch (caught) {
        show({ title: "Not logged", body: (caught as Error).message, tone: "error" });
      } finally {
        setBusy(null);
      }
    },
    [onLogged, onOpenChange, router, show],
  );

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="What should I eat?"
      elevated={elevated}
    >
      <div className="flex flex-col gap-3 pb-2" data-testid="suggest-sheet">
        {error ? (
          <div role="alert" className="flex flex-col items-start gap-2">
            <p className="text-body">{error}</p>
            <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : !data ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading suggestions">
            <Skeleton className="h-5" />
            <Skeleton className="h-16" />
            <Skeleton className="h-28" />
          </div>
        ) : (
          <>
            <p className="text-caption text-muted" data-testid="suggest-intro">
              {data.intro}
            </p>
            <LeftTiles data={data} />
            {data.note && (
              <p
                className="bg-warning-soft text-on-warning-soft text-caption rounded-xl px-3 py-2"
                data-testid="suggest-note"
              >
                {data.note}
              </p>
            )}
            {data.suggestions.length > 0 && (
              <>
                <h3 className="text-label" id="suggest-list">
                  From meals you have had
                </h3>
                <ul
                  aria-labelledby="suggest-list"
                  className="flex flex-col gap-2.5"
                  data-testid="suggest-list"
                >
                  {data.suggestions.map((item, index) => (
                    <Suggestion
                      key={item.mealId}
                      item={item}
                      first={index === 0}
                      busy={busy === item.mealId}
                      onLog={() => void log(item)}
                      onDetails={() => {
                        onOpenChange(false);
                        onDetails(item.mealId);
                      }}
                    />
                  ))}
                </ul>
              </>
            )}
            {data.history === "little" && data.suggestions.length > 0 && (
              <p className="text-caption text-muted">
                These are your favorites and recent meals; the order gets better as Kal learns when
                and how much you usually eat.
              </p>
            )}
            {data.idea && (
              <section
                aria-labelledby="balanced-heading"
                className="bg-surface-2 flex flex-col gap-1 rounded-2xl p-3"
                data-testid="suggest-balanced"
              >
                <h3 id="balanced-heading" className="text-label">
                  A balanced idea
                </h3>
                <p className="text-caption leading-snug">{data.idea.text}</p>
                <p className="text-caption text-muted">
                  Log a few meals, or star the ones you like, and Kal suggests from your own.
                </p>
              </section>
            )}
            {data.aiAvailable && data.size > 0 && (
              <AiIdea
                onTypeIt={(text) => {
                  onOpenChange(false);
                  onTypeIt(text);
                }}
              />
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
};
