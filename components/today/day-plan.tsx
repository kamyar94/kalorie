"use client";

import { CalendarCheck, CalendarDays, Dumbbell, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Stepper } from "@/components/ui/stepper";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import type { DayPlan, PlannedMealDto, RecipeInfoDto } from "@/lib/contracts/integrations";
import { MEAL_SLOT_LABELS } from "@/lib/contracts/meals";
import { deviceTimeZone } from "@/lib/photos/client";
import { formatKcal } from "@/lib/ui/format";

const SOURCE_TEXT = (recipe: RecipeInfoDto) =>
  recipe.nutritionSource === "mealie"
    ? "Nutrition per serving from Mealie."
    : recipe.nutritionSource === "computed"
      ? `Computed by Cal from ${recipe.ingredients.matched} of ${recipe.ingredients.total} ingredients.`
      : "Cal could not work out this recipe's nutrition.";

/** The recipe of a planned meal, its servings, and "Save nutrition to Mealie" when Mealie has none. */
const PlannedSheet = ({
  picked,
  onClose,
}: {
  picked: PlannedMealDto | null;
  onClose: () => void;
}) => {
  const router = useRouter();
  const { show } = useToast();
  const [servings, setServings] = useState(1);
  const [loaded, setLoaded] = useState<RecipeInfoDto | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [writing, setWriting] = useState(false);

  // A new pick starts from its own servings.
  const [shown, setShown] = useState<PlannedMealDto | null>(null);
  if (picked !== shown) {
    setShown(picked);
    setServings(picked?.servings || 1);
  }

  const slug = picked?.recipeSlug ?? null;
  const recipe = loaded && loaded.slug === slug ? loaded : null;
  useEffect(() => {
    if (!slug) return;
    let alive = true;
    api
      .mealieRecipe(slug)
      .then((info) => alive && setLoaded(info))
      .catch(() => alive && setFailedFor(slug));
    return () => {
      alive = false;
    };
  }, [slug]);

  const log = async () => {
    if (!picked) return;
    setSaving(true);
    try {
      const { mealId } = await api.logPlanned(picked.id, {
        servings,
        eatenAt: new Date().toISOString(),
        tz: deviceTimeZone(),
      });
      onClose();
      router.push(`/meals/${mealId}`);
    } catch (error) {
      show({ title: "Not logged", body: (error as Error).message, tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  const saveToMealie = async () => {
    if (!slug) return;
    setWriting(true);
    try {
      setLoaded(await api.saveRecipeNutrition(slug));
      show({ title: "Nutrition saved to Mealie", tone: "success" });
    } catch (error) {
      show({ title: "Not saved to Mealie", body: (error as Error).message, tone: "error" });
    } finally {
      setWriting(false);
    }
  };

  const perServing = recipe?.perServing.energy ?? picked?.kcalPerServing ?? null;
  const loading = !!slug && !recipe && failedFor !== slug;

  return (
    <BottomSheet
      open={!!picked}
      onOpenChange={(open) => !open && onClose()}
      title={picked ? `Log ${picked.name}` : "Log"}
      description={
        perServing !== null ? `${formatKcal(perServing)} kcal per serving` : "From your meal plan"
      }
      footer={
        <Button fullWidth size="lg" loading={saving} onClick={() => void log()}>
          Log {servings === 1 ? "1 serving" : `${servings} servings`}
          {perServing !== null && ` (${formatKcal(perServing * servings)} kcal)`}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-label">Servings</span>
          <Stepper
            label="Servings"
            value={servings}
            onChange={setServings}
            min={0.5}
            max={10}
            step={0.5}
          />
        </div>
        {loading && <p className="text-caption text-muted">Reading the recipe…</p>}
        {recipe && (
          <p className="text-caption text-muted" data-testid="recipe-source">
            {SOURCE_TEXT(recipe)}
          </p>
        )}
        {recipe?.canSaveToMealie && (
          <div className="bg-surface-2 flex flex-col gap-2 rounded-2xl p-3">
            <p className="text-caption">
              This recipe has no nutrition in Mealie. Cal can write its computed values into the
              recipe, for everyone in your household.
            </p>
            <Button variant="secondary" loading={writing} onClick={() => void saveToMealie()}>
              <Upload aria-hidden className="size-4" /> Save nutrition to Mealie
            </Button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
};

/**
 * Planned Mealie meals as tap-to-log chips and openGym workouts with their energy estimate. Shown
 * when Mealie is connected or the integrations have something for the day.
 */
export const DayPlanSection = ({ plan }: { plan: DayPlan }) => {
  const [picked, setPicked] = useState<PlannedMealDto | null>(null);

  if (!plan.planned.length && !plan.workouts.length && !plan.mealieConnected) return null;

  return (
    <Card as="section" aria-labelledby="plan-heading" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="plan-heading" className="text-headline">
          Planned
        </h2>
        {plan.mealieConnected && (
          <Link
            href="/plan"
            className="text-label text-primary hover:bg-surface-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3"
          >
            <CalendarDays aria-hidden className="size-4" /> Plan meals
          </Link>
        )}
      </div>
      {plan.planned.length > 0 ? (
        <div>
          <p className="text-caption text-muted mb-2 inline-flex items-center gap-1.5">
            <CalendarCheck aria-hidden className="size-4" /> From your meal plan, tap to log
          </p>
          <ul className="flex flex-wrap gap-2" data-no-swipe aria-label="Planned meals">
            {plan.planned.map((meal) => (
              <li key={meal.id}>
                <button
                  type="button"
                  disabled={meal.logged}
                  data-plan-id={meal.id}
                  onClick={() => setPicked(meal)}
                  className="bg-surface-2 hover:bg-surface-3 text-label inline-flex min-h-11 items-center gap-2 rounded-full px-4 disabled:opacity-60"
                >
                  {!meal.logged && <Plus aria-hidden className="size-4" />}
                  <span dir="auto">{meal.name}</span>
                  {meal.slot && (
                    <span className="text-caption text-muted">{MEAL_SLOT_LABELS[meal.slot]}</span>
                  )}
                  {meal.kcalPerServing !== null && !meal.logged && (
                    <span className="text-caption text-muted tabular">
                      {formatKcal(meal.kcalPerServing)} kcal
                    </span>
                  )}
                  {meal.logged && <span className="text-caption text-muted">Logged</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        plan.mealieConnected && (
          <p className="text-caption text-muted">Nothing planned in Mealie for this day.</p>
        )
      )}
      {plan.workouts.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Workouts">
          {plan.workouts.map((workout) => (
            <li key={workout.id} className="flex items-center gap-3" data-testid="workout">
              <span
                aria-hidden
                className="bg-primary-soft text-on-primary-soft grid size-10 place-items-center rounded-full"
              >
                <Dumbbell className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-label truncate" dir="auto">
                  {workout.name}
                </p>
                <p className="text-caption text-muted">
                  {workout.startTime ? `${workout.startTime} · ` : ""}
                  {Math.round(workout.durationMin)} min
                  {workout.exercises.length ? ` · ${workout.exercises.length} exercises` : ""}
                </p>
              </div>
              {workout.kcalEstimate !== null && (
                <p className="text-caption text-muted text-right">
                  <span className="tabular text-label text-text">
                    {formatKcal(workout.kcalEstimate)}
                  </span>{" "}
                  kcal burned
                  <br />
                  estimate
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <PlannedSheet picked={picked} onClose={() => setPicked(null)} />
    </Card>
  );
};
