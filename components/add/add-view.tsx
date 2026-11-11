"use client";

import { ArrowLeft, FileText, PenLine, ScanBarcode } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { useCapture } from "@/components/capture/capture-provider";
import { FoodRow } from "@/components/food/food-row";
import { FoodSearch } from "@/components/food/food-search";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { api, type UsedFood } from "@/lib/client/api";
import type { FoodResult } from "@/lib/contracts/food-search";
import { dayTitle, formatWeight, type Units } from "@/lib/ui/format";

import { AddFoodSheet, type PickedFood } from "./add-food-sheet";
import { BarcodeSheet } from "./barcode-sheet";
import { CustomFoodSheet } from "./custom-food-sheet";

const Action = ({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="border-border bg-surface shadow-card hover:bg-surface-2 flex min-h-24 flex-col items-start gap-1 rounded-[var(--radius-card)] border p-3.5 text-left transition-colors"
  >
    <span
      aria-hidden
      className="bg-primary-soft text-on-primary-soft grid size-9 place-items-center rounded-full"
    >
      {icon}
    </span>
    <span className="text-label">{label}</span>
    <span className="text-caption text-muted">{hint}</span>
  </button>
);

const UsedList = ({
  title,
  foods,
  units,
  onPick,
}: {
  title: string;
  foods: UsedFood[];
  units: Units;
  onPick: (used: UsedFood) => void;
}) =>
  foods.length ? (
    <section aria-label={title}>
      <h2 className="text-label text-muted mb-1 px-3">{title}</h2>
      <ul className="flex flex-col gap-1">
        {foods.map((used) => (
          <li key={used.food.id}>
            <FoodRow
              food={used.food}
              onPick={() => onPick(used)}
              detail={`Last time ${used.lastPortionText ? `${used.lastPortionText}, ` : ""}${formatWeight(used.lastGrams, units)}`}
            />
          </li>
        ))}
      </ul>
    </section>
  ) : null;

/**
 * Add without a photo (docs/DESIGN.md section 7): search, recent and frequent foods, barcode
 * scan, a photo of a label, and a custom food. Adds to an existing meal (mealId) or logs a new
 * one on `date`.
 */
export const AddView = ({
  mealId,
  mealTitle,
  date,
  today,
  units,
}: {
  mealId: string | null;
  mealTitle: string | null;
  date: string | null;
  today: string;
  units: Units;
}) => {
  const router = useRouter();
  const { show } = useToast();
  const { openCamera } = useCapture();
  const [used, setUsed] = useState<{ recent: UsedFood[]; frequent: UsedFood[] } | null>(null);
  const [picked, setPicked] = useState<PickedFood | null>(null);
  const [scanning, setScanning] = useState(false);
  const [custom, setCustom] = useState<{ barcode?: string; name?: string } | null>(null);
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api
      .usedFoods()
      .then(setUsed)
      .catch(() => setUsed({ recent: [], frequent: [] }));
  }, []);

  const onCode = useCallback(
    async (code: string) => {
      setScanning(false);
      try {
        const food = await api.barcode(code);
        if (food) setPicked({ food });
        else setUnknownCode(code);
      } catch (error) {
        show({
          title: "The barcode could not be looked up",
          body: error instanceof Error ? error.message : undefined,
          tone: "error",
        });
      }
    },
    [show],
  );

  const backHref = mealId
    ? `/meals/${mealId}`
    : date && date !== today
      ? `/today?date=${date}`
      : "/today";
  const heading = mealId ? "Add to the meal" : "Add food";
  const sub = mealId
    ? (mealTitle ?? "")
    : date && date !== today
      ? `Logged on ${dayTitle(date, today)}`
      : "Without a photo";

  // The frequent list repeats less: foods already in the recent list are left out of it.
  const recentIds = new Set(used?.recent.map((u) => u.food.id));
  const frequent = used?.frequent.filter((u) => !recentIds.has(u.food.id)) ?? [];

  return (
    <>
      <header className="flex items-center gap-2">
        <Link
          href={backHref}
          aria-label="Back"
          className="hover:bg-surface-2 -ml-2 grid size-11 shrink-0 place-items-center rounded-full"
        >
          <ArrowLeft aria-hidden className="size-6" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-title">{heading}</h1>
          {sub && (
            <p className="text-caption text-muted truncate" dir="auto">
              {sub}
            </p>
          )}
        </div>
      </header>

      <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] md:items-start md:gap-6">
        <div className="order-2 md:order-1">
          <FoodSearch
            onQueryChange={setQuery}
            onPick={(food: FoodResult) => setPicked({ food })}
            idle={
              used ? (
                used.recent.length || frequent.length ? (
                  <div className="flex flex-col gap-4">
                    <UsedList
                      title="Recent"
                      foods={used.recent}
                      units={units}
                      onPick={(u) =>
                        setPicked({
                          food: u.food,
                          grams: u.lastGrams,
                          portionText: u.lastPortionText,
                        })
                      }
                    />
                    <UsedList
                      title="Frequent"
                      foods={frequent}
                      units={units}
                      onPick={(u) =>
                        setPicked({
                          food: u.food,
                          grams: u.lastGrams,
                          portionText: u.lastPortionText,
                        })
                      }
                    />
                  </div>
                ) : (
                  <p className="text-body text-muted px-3 py-2">
                    Foods you log show up here, so the next time is one tap.
                  </p>
                )
              ) : (
                <div className="flex flex-col gap-2" aria-hidden>
                  <Skeleton className="h-16 rounded-2xl" />
                  <Skeleton className="h-16 rounded-2xl" />
                </div>
              )
            }
            empty={(text) => (
              <div className="flex flex-col items-start gap-2 px-3 py-3">
                <p className="text-body text-muted">No foods found for &quot;{text}&quot;.</p>
                <Button variant="secondary" onClick={() => setCustom({ name: text })}>
                  <PenLine aria-hidden className="size-4" /> Add &quot;{text}&quot; as a new food
                </Button>
              </div>
            )}
          />
        </div>

        <div
          className={`order-1 grid grid-cols-3 gap-2 md:order-2 md:grid-cols-1 ${query ? "max-md:hidden" : ""}`}
        >
          <Action
            icon={<ScanBarcode className="size-5" />}
            label="Scan a barcode"
            hint="Packaged food"
            onClick={() => setScanning(true)}
          />
          <Action
            icon={<FileText className="size-5" />}
            label="Photo of a label"
            hint="Kal reads it"
            onClick={() => openCamera("label")}
          />
          <Action
            icon={<PenLine className="size-5" />}
            label="New food"
            hint="Type the values"
            onClick={() => setCustom({})}
          />
        </div>
      </div>

      <AddFoodSheet
        picked={picked}
        toMeal={!!mealId}
        date={date}
        units={units}
        onClose={() => setPicked(null)}
        onAdd={async (item, when) => {
          if (mealId) {
            await api.addItem(mealId, item);
            setPicked(null);
            show({ title: `Added ${item.name}`, tone: "success" });
            router.push(`/meals/${mealId}`);
            router.refresh();
          } else {
            const meal = await api.createManualMeal({
              eatenAt: when!.eatenAt,
              tz: when!.tz,
              items: [item],
            });
            setPicked(null);
            show({ title: `Logged ${item.name}`, tone: "success" });
            router.push(`/meals/${meal.id}`);
          }
        }}
      />
      <BarcodeSheet
        open={scanning}
        onOpenChange={setScanning}
        onCode={(code) => void onCode(code)}
      />
      <CustomFoodSheet
        open={!!custom}
        barcode={custom?.barcode}
        name={custom?.name}
        onOpenChange={(open) => !open && setCustom(null)}
        onCreated={(food) => {
          setCustom(null);
          setPicked({ food });
        }}
      />
      <BottomSheet
        open={!!unknownCode}
        onOpenChange={(open) => !open && setUnknownCode(null)}
        title="Kal does not know this product yet"
        description={unknownCode ? `Barcode ${unknownCode}` : undefined}
      >
        <div className="flex flex-col gap-2 pb-2">
          <Button
            size="lg"
            onClick={() => {
              setUnknownCode(null);
              openCamera("label");
            }}
          >
            <FileText aria-hidden className="size-5" /> Take a photo of the label
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => {
              const code = unknownCode ?? undefined;
              setUnknownCode(null);
              setCustom({ barcode: code });
            }}
          >
            <PenLine aria-hidden className="size-5" /> Type the nutrition facts
          </Button>
        </div>
      </BottomSheet>
    </>
  );
};
