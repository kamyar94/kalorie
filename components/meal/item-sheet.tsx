"use client";

import { ArrowLeft, Check, Loader2, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { FoodSearch } from "@/components/food/food-search";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Slider } from "@/components/ui/slider";
import { Stepper } from "@/components/ui/stepper";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import type { FoodResult } from "@/lib/contracts/food-search";
import type { ItemPatch, MealItemDto, NutrientSource } from "@/lib/contracts/meals";
import type { NutrientCode } from "@/lib/contracts/nutrients";
import type { NutrientTarget } from "@/lib/contracts/targets";
import { GRAMS_PER_OUNCE, formatKcal, formatWeight, type Units } from "@/lib/ui/format";
import { gramsRange, previewItem } from "@/lib/ui/item-preview";

import { MacroSummary } from "./macro-summary";
import { NutrientTable } from "./nutrient-table";

export const SOURCE_TEXT: Record<NutrientSource, string> = {
  food: "From the food database",
  components: "Sum of its ingredients",
  ai_estimate: "AI estimate (no database match)",
  recipe: "From the recipe",
  usual: "From your usual portion",
  manual: "Entered by hand",
};

type Snapshot = Pick<
  MealItemDto,
  "grams" | "ml" | "count" | "portionText" | "foodId" | "nutrients"
>;
const snapshot = (item: MealItemDto): Snapshot => ({
  grams: item.grams,
  ml: item.ml,
  count: item.count,
  portionText: item.portionText,
  foodId: item.foodId,
  nutrients: item.nutrients,
});

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * The item sheet (docs/DESIGN.md section 7): grams slider over the model's range plus free entry,
 * portion buttons, count stepper, the matched food with "change", the nutrients, delete. Every
 * change shows at once and saves itself; Undo steps back through the changes. When the sheet
 * closes after changes, the corrected item is remembered for next time.
 */
export const ItemSheet = ({
  item,
  units,
  targets,
  onChange,
  onDelete,
  onClose,
}: {
  item: MealItemDto | null;
  units: Units;
  targets: Partial<Record<NutrientCode, NutrientTarget>>;
  onChange: (item: MealItemDto) => void;
  onDelete: (item: MealItemDto) => void;
  onClose: () => void;
}) => {
  const { show } = useToast();
  const [loadedFood, setFood] = useState<FoodResult | null>(null);
  const [changing, setChanging] = useState(false);
  const [save, setSave] = useState<SaveState>("idle");
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [draft, setDraft] = useState<number | null>(null);
  const [entry, setEntry] = useState("");
  const corrected = useRef(false);
  const seq = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const amountId = useId();
  const openId = item?.id ?? null;
  // The matched food, once loaded (portions and values per 100 g).
  const food = loadedFood && item?.foodId === loadedFood.id ? loadedFood : null;

  useEffect(() => {
    const foodId = item?.foodId;
    if (!foodId || loadedFood?.id === foodId) return;
    let stale = false;
    api
      .getFood(foodId)
      .then((f) => {
        if (!stale) setFood(f);
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [item?.foodId, loadedFood?.id]);

  // A new item starts with a clean slate (state adjusted during render).
  const [shownId, setShownId] = useState(openId);
  if (shownId !== openId) {
    setShownId(openId);
    setHistory([]);
    setSave("idle");
    setChanging(false);
    setDraft(null);
  }

  // Closing the sheet after changes remembers the corrected item once.
  useEffect(() => {
    corrected.current = false;
    return () => {
      if (openId && corrected.current) void api.rememberItem(openId).catch(() => undefined);
    };
  }, [openId]);

  const usesMl = item?.ml !== null && item?.ml !== undefined;
  const amount = item ? (usesMl ? (item.ml ?? 0) : item.grams) : 0;
  const [entryFor, setEntryFor] = useState<number | null>(null);
  if (entryFor !== amount) {
    setEntryFor(amount);
    setEntry(amount ? String(Math.round(amount * 10) / 10) : "");
  }

  const send = useCallback(
    (patch: ItemPatch, previous: MealItemDto, knownFood: FoodResult | null) => {
      const optimistic = previewItem(previous, patch, knownFood);
      onChange(optimistic);
      corrected.current = true;
      const mine = ++seq.current;
      setSave("saving");
      chain.current = chain.current.then(async () => {
        try {
          const saved = await api.patchItem(previous.id, patch);
          if (mine === seq.current) {
            onChange(saved);
            setSave("saved");
          }
        } catch (error) {
          if (mine === seq.current) {
            onChange(previous);
            setSave("error");
            show({
              title: "The change was not saved",
              body: error instanceof Error ? error.message : undefined,
              tone: "error",
            });
          }
        }
      });
    },
    [onChange, show],
  );

  const commit = (patch: ItemPatch, knownFood: FoodResult | null = food) => {
    if (!item) return;
    setHistory((h) => [...h.slice(-19), snapshot(item)]);
    send(patch, item, knownFood);
  };

  const undo = () => {
    if (!item || !history.length) return;
    const previous = history[history.length - 1]!;
    setHistory((h) => h.slice(0, -1));
    const patch: ItemPatch = {
      grams: previous.grams,
      ml: previous.ml,
      count: previous.count,
      portionText: previous.portionText,
      foodId: previous.foodId,
      // Without a food, the earlier values are restored as they were.
      ...(previous.foodId ? {} : { nutrients: previous.nutrients }),
    };
    // The food of that earlier state is loaded again by the effect above if needed.
    const restoreFood = previous.foodId && loadedFood?.id === previous.foodId ? loadedFood : null;
    send(patch, item, restoreFood);
  };

  const commitAmount = (value: number) => {
    if (!item || !Number.isFinite(value) || value <= 0) return;
    const rounded = Math.round(value * 10) / 10;
    if (rounded === amount) return;
    commit(usesMl ? { ml: rounded, portionText: null } : { grams: rounded, portionText: null });
  };

  const range = item
    ? gramsRange({
        grams: amount,
        gramsLow: usesMl ? null : item.gramsLow,
        gramsHigh: usesMl ? null : item.gramsHigh,
      })
    : { min: 1, max: 100, step: 1 };
  const shown = draft ?? amount;
  const preview =
    item && draft !== null
      ? previewItem(item, usesMl ? { ml: draft } : { grams: draft }, food)
      : item;
  const unit = usesMl ? "ml" : "g";

  return (
    <BottomSheet
      open={!!item}
      onOpenChange={(open) => !open && onClose()}
      title={changing ? "Change the food" : (item?.name ?? "Item")}
      description={
        changing
          ? "Pick what this item really is."
          : item?.localName && item.localName !== item.name
            ? item.localName
            : undefined
      }
      className="md:w-[min(36rem,calc(100vw-2rem))]"
      footer={
        item && !changing ? (
          <div className="flex items-center gap-2">
            <p
              className="text-caption text-muted inline-flex flex-1 items-center gap-1.5"
              aria-live="polite"
              data-testid="save-state"
            >
              {save === "saving" && (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
                  Saving…
                </>
              )}
              {save === "saved" && (
                <>
                  <Check aria-hidden className="text-primary size-4" /> Saved
                </>
              )}
              {save === "error" && <span className="text-danger">Not saved</span>}
              {save === "idle" && "Changes save themselves"}
            </p>
            <Button variant="secondary" onClick={undo} disabled={!history.length}>
              <Undo2 aria-hidden className="size-4" /> Undo
            </Button>
            <Button
              variant="ghost"
              className="text-danger"
              onClick={() => {
                onDelete(item);
                onClose();
              }}
            >
              <Trash2 aria-hidden className="size-4" /> Delete
            </Button>
          </div>
        ) : undefined
      }
    >
      {item && changing && (
        <div className="flex flex-col gap-3 pb-2">
          <button
            type="button"
            onClick={() => setChanging(false)}
            className="text-label text-primary inline-flex min-h-11 items-center gap-1.5 self-start"
          >
            <ArrowLeft aria-hidden className="size-4" /> Back to the item
          </button>
          <FoodSearch
            autoFocus
            label="Search for the right food"
            onPick={(picked) => {
              setFood(picked);
              setChanging(false);
              commit({ foodId: picked.id }, picked);
            }}
          />
        </div>
      )}

      {item && preview && !changing && (
        <div className="flex flex-col gap-5 pb-2">
          <MacroSummary nutrients={preview.nutrients} />

          {/* Amount */}
          <section aria-labelledby={`${amountId}-h`} className="flex flex-col gap-2">
            <div className="flex items-end justify-between gap-3">
              <h3 id={`${amountId}-h`} className="text-label">
                Amount
              </h3>
              <div className="flex items-center gap-2">
                <label htmlFor={amountId} className="sr-only">
                  {usesMl ? "Millilitres" : "Grams"}
                </label>
                <input
                  id={amountId}
                  inputMode="decimal"
                  value={draft !== null ? String(Math.round(draft)) : entry}
                  onChange={(event) => setEntry(event.target.value.replace(/[^\d.,]/g, ""))}
                  onBlur={() => commitAmount(Number(entry.replace(",", ".")))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitAmount(Number(entry.replace(",", ".")));
                  }}
                  className="border-border bg-surface tabular text-title focus:border-primary h-12 w-28 rounded-[var(--radius-control)] border px-3 text-right focus:outline-none focus-visible:outline-3 focus-visible:outline-[var(--focus)]"
                />
                <span className="text-body text-muted w-6">{unit}</span>
              </div>
            </div>
            {units === "imperial" && !usesMl && (
              <p className="text-caption text-muted text-right">
                {formatWeight(shown, "imperial")} ({(shown / GRAMS_PER_OUNCE).toFixed(1)} oz)
              </p>
            )}
            <Slider
              label={usesMl ? "Millilitres" : "Grams"}
              valueText={`${Math.round(shown)} ${usesMl ? "millilitres" : "grams"}`}
              value={Math.min(range.max, Math.max(range.min, shown))}
              min={range.min}
              max={range.max}
              step={range.step}
              onValueChange={setDraft}
              onValueCommit={(value) => {
                setDraft(null);
                commitAmount(value);
              }}
            />
            {item.gramsLow && item.gramsHigh && !usesMl ? (
              <p className="text-caption text-muted">
                Kal estimated {Math.round(item.gramsLow)} to {Math.round(item.gramsHigh)} g
                {item.modelGrams ? ` (about ${Math.round(item.modelGrams)} g)` : ""}.
              </p>
            ) : null}
            {food?.portions.length ? (
              <ul aria-label="Portions" className="mt-1 flex flex-wrap gap-2">
                {food.portions.slice(0, 8).map((portion) => {
                  const active = item.portionText === portion.label && !usesMl;
                  return (
                    <li key={portion.id}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          commit({ grams: portion.grams, ml: null, portionText: portion.label })
                        }
                        className={cn(
                          "text-label min-h-11 rounded-full border px-3.5 transition-colors",
                          active
                            ? "bg-primary-soft text-on-primary-soft border-transparent"
                            : "border-border hover:bg-surface-2",
                        )}
                      >
                        <span dir="auto">{portion.label}</span>{" "}
                        <span className="text-caption text-muted">
                          {Math.round(portion.grams)} g
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <div className="mt-1 flex items-center justify-between">
              <span className="text-label">How many</span>
              <Stepper
                label="How many"
                value={item.count}
                onChange={(count) => commit({ count })}
                min={0.5}
                max={20}
                step={0.5}
                format={(v) => `${v}×`}
              />
            </div>
          </section>

          {/* Matched food */}
          <section aria-labelledby={`${amountId}-food`} className="bg-surface-2 rounded-2xl p-3.5">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h3 id={`${amountId}-food`} className="text-caption text-muted">
                  {item.foodId ? "Matched food" : "No food matched"}
                </h3>
                <p className="text-body font-medium" dir="auto">
                  {item.foodName ?? food?.nameEn ?? "Values estimated by the AI"}
                </p>
                <p className="text-caption text-muted">
                  {SOURCE_TEXT[item.nutrientSource]}
                  {food?.sourceNote ? ` · ${food.sourceNote}` : ""}
                </p>
              </div>
              <Button variant="secondary" onClick={() => setChanging(true)}>
                <RefreshCw aria-hidden className="size-4" /> Change
              </Button>
            </div>
            {item.confidence !== null && item.confidence < 0.5 && (
              <p className="text-caption text-on-warning-soft bg-warning-soft mt-2 rounded-lg px-2 py-1">
                Kal was unsure about this item. Check the food and the amount.
              </p>
            )}
          </section>

          {item.components.length > 0 && (
            <section aria-label="Ingredients">
              <h3 className="text-label mb-1">Ingredients</h3>
              <ul className="text-body">
                {item.components.map((c, i) => (
                  <li
                    key={`${c.name}-${i}`}
                    className="border-border flex justify-between border-b py-1.5 last:border-b-0"
                  >
                    <span dir="auto">{c.name}</span>
                    <span className="tabular text-muted">
                      {Math.round(c.grams)} g · {formatKcal(c.nutrients.energy)} kcal
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <details className="group">
            <summary className="text-label text-primary min-h-11 cursor-pointer list-none py-2.5 [&::-webkit-details-marker]:hidden">
              All nutrients of this item
            </summary>
            <NutrientTable nutrients={preview.nutrients} targets={targets} caption={item.name} />
          </details>
        </div>
      )}
    </BottomSheet>
  );
};
