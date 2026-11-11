"use client";

import {
  AlertCircle,
  ArrowLeft,
  Clock,
  Copy,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Settings,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { AutoRefresh } from "@/components/app/auto-refresh";
import { PlateIcon } from "@/components/app/plate-icon";
import { WhenSheet } from "@/components/capture/when-sheet";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import type { ItemInput, MealDto, MealItemDto, MealPatch } from "@/lib/contracts/meals";
import { ANALYSED_SOURCES, MEAL_SLOT_LABELS } from "@/lib/contracts/meals";
import type { NutrientCode } from "@/lib/contracts/nutrients";
import type { NutrientTarget } from "@/lib/contracts/targets";
import { dayTitle, formatItemAmount, formatKcal, type Units } from "@/lib/ui/format";
import { totalsOf } from "@/lib/ui/item-preview";

import { AgainSheet } from "./again-sheet";
import { DetailsSheet } from "./details-sheet";
import { FixSentence } from "./fix-sentence";
import { ItemSheet } from "./item-sheet";
import { MacroSummary } from "./macro-summary";
import { MealPhotos } from "./meal-photos";
import { NutrientTable } from "./nutrient-table";
import { PhotoCarousel } from "./photo-carousel";
import { Questions } from "./questions";

const formatGrams = (value: number | undefined) =>
  typeof value === "number" ? `${Math.round(value)} g` : "–";

const toInput = (item: MealItemDto): ItemInput => ({
  name: item.name,
  localName: item.localName,
  kind: item.kind,
  foodId: item.foodId,
  grams: item.grams,
  ml: item.ml,
  count: item.count,
  portionText: item.portionText,
  ...(item.foodId ? {} : { nutrients: item.nutrients }),
});

/** The meal screen (docs/DESIGN.md section 7). */
export const MealView = ({
  initial,
  targets,
  units,
  today,
}: {
  initial: MealDto;
  targets: Partial<Record<NutrientCode, NutrientTarget>>;
  units: Units;
  today: string;
}) => {
  const router = useRouter();
  const { show } = useToast();
  const [meal, setMeal] = useState(initial);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [again, setAgain] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // A fresh server render (auto refresh while analysing, router.refresh) replaces local state.
  const [shownInitial, setShownInitial] = useState(initial);
  if (initial !== shownInitial) {
    setShownInitial(initial);
    setMeal(initial);
  }

  const title = meal.title ?? MEAL_SLOT_LABELS[meal.slot];
  // queued: waiting for the worker (new photos, an answer, a correction or a retry after a
  // provider error, which meal.error then explains); analysing: the worker is on it.
  const analysing = meal.status === "queued" || meal.status === "analysing";
  const totals = meal.items.length ? totalsOf(meal.items) : meal.totals;
  const item = meal.items.find((i) => i.id === openItem) ?? null;
  const backHref = meal.localDate === today ? "/today" : `/today?date=${meal.localDate}`;
  // Photo and text meals are analysed by the AI, so they can be analysed again or fixed in words.
  const analysed = ANALYSED_SOURCES.includes(meal.source);
  const textMeal = meal.source === "text";

  const fail = useCallback(
    (title: string, error: unknown) =>
      show({ title, body: error instanceof Error ? error.message : undefined, tone: "error" }),
    [show],
  );

  const replaceItem = useCallback(
    (next: MealItemDto) =>
      setMeal((m) => ({ ...m, items: m.items.map((i) => (i.id === next.id ? next : i)) })),
    [],
  );

  const deleteItem = async (target: MealItemDto) => {
    setMeal((m) => ({ ...m, items: m.items.filter((i) => i.id !== target.id) }));
    try {
      await api.deleteItem(target.id);
      show({
        title: `Removed ${target.name}`,
        action: {
          label: "Undo",
          onClick: () =>
            void api
              .addItem(meal.id, toInput(target))
              .then((restored) =>
                setMeal((m) => ({
                  ...m,
                  items: [...m.items, { ...restored, position: target.position }].sort(
                    (a, b) => a.position - b.position,
                  ),
                })),
              )
              .catch((error) => fail("Could not bring it back", error)),
        },
      });
    } catch (error) {
      setMeal((m) => ({
        ...m,
        items: [...m.items, target].sort((a, b) => a.position - b.position),
      }));
      fail("The item was not removed", error);
    }
  };

  const savePatch = async (patch: MealPatch) => {
    try {
      const updated = await api.patchMeal(meal.id, patch);
      setMeal(updated);
      router.refresh();
      return true;
    } catch (error) {
      fail("Not saved", error);
      return false;
    }
  };

  const answer = async (questionId: string, value: string) => {
    try {
      setMeal(await api.answer(meal.id, questionId, value));
      show({ title: "Thanks, Cal is updating the meal", tone: "success" });
    } catch (error) {
      fail("The answer was not sent", error);
    }
  };

  const correct = async (text: string, replaceEdits: boolean) => {
    try {
      setMeal(await api.correct(meal.id, text, replaceEdits));
      show({ title: "Cal is updating the meal", tone: "success" });
      return true;
    } catch (error) {
      fail("The correction was not sent", error);
      return false;
    }
  };

  const retry = async () => {
    try {
      setMeal(await api.retry(meal.id));
    } catch (error) {
      fail("Could not try again", error);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.deleteMeal(meal.id);
      show({ title: "Meal deleted", tone: "neutral" });
      router.push(backHref);
      router.refresh();
    } catch (error) {
      fail("The meal was not deleted", error);
      setDeleting(false);
    }
  };

  return (
    <>
      <header className="flex items-center gap-2">
        <Link
          href={backHref}
          aria-label={`Back to ${dayTitle(meal.localDate, today)}`}
          className="hover:bg-surface-2 -ml-2 grid size-11 shrink-0 place-items-center rounded-full"
        >
          <ArrowLeft aria-hidden className="size-6" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-title truncate" dir="auto">
            {title}
          </h1>
          <p className="text-caption text-muted">
            {dayTitle(meal.localDate, today)} · <span className="tabular">{meal.localTime}</span> ·{" "}
            {MEAL_SLOT_LABELS[meal.slot]}
            {textMeal && " · typed meal"}
          </p>
        </div>
        <Button
          variant="secondary"
          className="rounded-full px-3.5"
          aria-haspopup="dialog"
          onClick={() => setTimeOpen(true)}
        >
          <Clock aria-hidden className="size-4" /> Time
        </Button>
        <Button variant="secondary" className="px-3.5" onClick={() => setDetails(true)}>
          <Pencil aria-hidden className="size-4" /> Edit
        </Button>
      </header>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-start md:gap-6">
        <div className="flex flex-col gap-4">
          <PhotoCarousel photos={meal.photos} title={title} />
          {!meal.photos.length && (
            // Without a photo the meal is a plate with its foods on it.
            <Card className="flex items-center gap-4" data-testid="plate-header">
              <PlateIcon
                size="lg"
                foods={meal.items}
                label={meal.items.length ? undefined : "Empty plate"}
              />
              <div className="flex min-w-0 flex-col gap-1.5">
                <p>
                  <span className="tabular text-[2.25rem] leading-none font-bold tracking-tight">
                    {formatKcal(totals.energy)}
                  </span>{" "}
                  <span className="text-label text-muted font-normal">kcal</span>
                </p>
                <p className="text-caption text-muted">
                  P {formatGrams(totals.protein)} · C {formatGrams(totals.carbs)} · F{" "}
                  {formatGrams(totals.fat)}
                </p>
              </div>
            </Card>
          )}

          <MealPhotos
            meal={meal}
            onChange={(change) => {
              setMeal(change.meal);
              router.refresh();
            }}
          />

          {analysing && (
            <div
              role="status"
              className="bg-surface-2 flex items-center gap-3 rounded-[var(--radius-card)] p-4"
            >
              <Loader2
                aria-hidden
                className="text-primary size-6 shrink-0 animate-spin motion-reduce:animate-none"
              />
              <div>
                <p className="text-label">
                  {textMeal ? "Working out your meal" : "Analysing your photos"}
                </p>
                <p className="text-caption text-muted">
                  {meal.error?.message ??
                    "This usually takes less than a minute. You can leave this page."}
                </p>
              </div>
            </div>
          )}

          {meal.status === "failed" && (
            <div
              role="alert"
              className="bg-danger-soft text-on-danger-soft flex flex-col gap-3 rounded-[var(--radius-card)] p-4"
            >
              <p className="text-body inline-flex items-start gap-2">
                <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0" />
                {meal.error?.message ?? "The analysis did not finish."}
              </p>
              <div className="flex flex-wrap gap-2">
                {meal.error?.settingsLink && (
                  <Button asChild variant="secondary">
                    <Link href="/settings#ai">
                      <Settings aria-hidden className="size-4" /> Open AI settings
                    </Link>
                  </Button>
                )}
                {/* After a key problem is fixed in Settings, the meal can go again. */}
                {analysed && (
                  <Button variant="secondary" onClick={() => void retry()}>
                    <RotateCcw aria-hidden className="size-4" /> Try again
                  </Button>
                )}
                <Button asChild variant="ghost">
                  <Link href={`/add?meal=${meal.id}`}>
                    <Plus aria-hidden className="size-4" /> Add foods by hand
                  </Link>
                </Button>
              </div>
            </div>
          )}

          <Questions questions={meal.questions} disabled={analysing} onAnswer={answer} />

          {textMeal && meal.note ? (
            <section
              aria-labelledby="wrote-heading"
              className="bg-primary-soft text-on-primary-soft flex flex-col gap-1 rounded-2xl px-3.5 py-3"
            >
              <h2 id="wrote-heading" className="text-label">
                What you wrote
              </h2>
              <p className="text-body leading-[1.45]" dir="auto" data-testid="meal-text">
                {meal.note}
              </p>
            </section>
          ) : (
            meal.note && (
              <p className="text-body text-muted" dir="auto">
                <span className="text-label text-text">Your note: </span>
                {meal.note}
              </p>
            )
          )}

          {analysed && (
            <Card as="section">
              <FixSentence disabled={analysing} onSubmit={correct} />
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card as="section" aria-labelledby="items-heading" padded={false} className="py-2">
            <div className="flex items-center justify-between px-4 pt-2 pb-1">
              <h2 id="items-heading" className="text-headline">
                Items
              </h2>
              <Button asChild variant="ghost" className="text-primary -mr-2">
                <Link href={`/add?meal=${meal.id}`}>
                  <Plus aria-hidden className="size-4" /> Add
                </Link>
              </Button>
            </div>
            {meal.items.length ? (
              <ul data-testid="items">
                {meal.items.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => setOpenItem(entry.id)}
                      className="hover:bg-surface-2 flex min-h-16 w-full items-center gap-3 py-2.5 pr-4 pl-2.5 text-left transition-colors"
                    >
                      <span
                        aria-hidden
                        data-testid="item-emoji"
                        className="bg-surface-2 grid size-11 shrink-0 place-items-center rounded-xl text-2xl leading-none"
                      >
                        {entry.emoji}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="text-body block truncate font-medium" dir="auto">
                          {entry.name}
                        </span>
                        <span className="text-caption text-muted block truncate">
                          {formatItemAmount(entry, units)}
                          {entry.nutrientSource === "ai_estimate" && (
                            <span className="bg-warning-soft text-on-warning-soft ml-1.5 rounded-full px-1.5">
                              AI estimate
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="tabular text-headline block" data-testid="item-kcal">
                          {formatKcal(entry.nutrients.energy)}
                        </span>
                        <span className="text-caption text-muted">kcal</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : analysing ? (
              <div className="flex flex-col gap-2 px-4 py-2" aria-hidden>
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : (
              <p className="text-body text-muted px-4 py-3">
                No items yet. Add the foods by hand, or fix the meal with a sentence.
              </p>
            )}
          </Card>

          <Card as="section" aria-labelledby="totals-heading" className="flex flex-col gap-3">
            <h2 id="totals-heading" className="text-headline">
              Total
            </h2>
            <MacroSummary nutrients={totals} size="lg" />
            <details>
              <summary className="text-label text-primary min-h-11 cursor-pointer list-none py-2.5 [&::-webkit-details-marker]:hidden">
                All nutrients
              </summary>
              <NutrientTable nutrients={totals} targets={targets} caption="Meal total" />
              <p className="text-caption text-muted mt-3">
                Percentages are of your daily targets. A dash means the value is not known.
              </p>
            </details>
          </Card>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setAgain(true)}>
              <Copy aria-hidden className="size-5" /> I ate this again
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="text-danger"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 aria-hidden className="size-5" /> Delete meal
            </Button>
          </div>
        </div>
      </div>

      <ItemSheet
        item={item}
        units={units}
        targets={targets}
        onChange={replaceItem}
        onDelete={(target) => void deleteItem(target)}
        onClose={() => {
          setOpenItem(null);
          router.refresh();
        }}
      />
      <DetailsSheet meal={meal} open={details} onOpenChange={setDetails} onSave={savePatch} />
      <WhenSheet
        open={timeOpen}
        onOpenChange={setTimeOpen}
        value={new Date(meal.eatenAt)}
        tz={meal.tz}
        description="Moves the meal to that day and time."
        onDone={async (at) => {
          // "Now" is a moment like any other here: the meal moves to it.
          if (await savePatch({ eatenAt: (at ?? new Date()).toISOString(), tz: meal.tz }))
            setTimeOpen(false);
        }}
      />
      <AgainSheet
        open={again}
        onOpenChange={setAgain}
        onConfirm={async (when) => {
          try {
            const copy = await api.duplicateMeal(meal.id, when);
            setAgain(false);
            show({ title: "Logged again", tone: "success" });
            router.push(`/meals/${copy.id}`);
          } catch (error) {
            fail("Not logged", error);
          }
        }}
      />
      <BottomSheet
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this meal?"
        description="The meal, its photos and its items are removed from your log."
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="danger" size="lg" loading={deleting} onClick={() => void remove()}>
              Delete
            </Button>
          </div>
        }
      >
        <p className="text-body text-muted pb-2" dir="auto">
          {title}, {formatKcal(totals.energy)} kcal
        </p>
      </BottomSheet>

      <AutoRefresh active={analysing} intervalMs={4000} />
    </>
  );
};
