// Meal plan suggestions (docs/DESIGN.md section 8): for each chosen day, one Mealie recipe per
// chosen slot so the day stays within its energy target and reaches its protein target. Pure,
// deterministic code: the same recipes and targets always give the same plan.
//
// The day targets are shared out over the slots (breakfast 25 %, lunch 35 %, dinner 30 %,
// snack 10 %); a plan for some slots only is held to their share. Per day the search tries every
// combination of the best candidates per slot (at most CANDIDATES_PER_SLOT each), keeps those
// within the energy budget and at or above the protein minimum, and picks the one closest to the
// budget, preferring recipes not used on earlier days of the plan. When no combination fits, the
// one that misses least is shown and marked.
import type { PlanDayDto, PlanEntryDto } from "@/lib/contracts/integrations";
import type { MealSlot } from "@/lib/contracts/meals";

export const SLOT_SHARES: Record<MealSlot, number> = {
  breakfast: 0.25,
  lunch: 0.35,
  dinner: 0.3,
  snack: 0.1,
  // Not planned (PLAN_SLOTS), but every slot has a share.
  supper: 0.2,
  drink: 0.02,
  dessert: 0.1,
};

export const CANDIDATES_PER_SLOT = 10;
/** Penalty (share of the budget) for a recipe already used earlier in the plan. */
const REUSE_PENALTY = 0.15;

export type PlanRecipe = { id: string; slug: string; name: string; kcal: number; protein: number };

export type PlanInput = {
  days: string[];
  slots: MealSlot[];
  energyTarget: number;
  proteinTarget: number;
  recipes: PlanRecipe[];
};

const byName = (a: PlanRecipe, b: PlanRecipe) =>
  a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** Candidates for a slot: closest to the slot's energy share, then most protein per kcal. */
export const slotCandidates = (recipes: PlanRecipe[], slotBudget: number) =>
  [...recipes]
    .sort(
      (a, b) =>
        Math.abs(a.kcal - slotBudget) - Math.abs(b.kcal - slotBudget) ||
        b.protein / b.kcal - a.protein / a.kcal ||
        byName(a, b),
    )
    .slice(0, CANDIDATES_PER_SLOT);

type Choice = { recipes: PlanRecipe[]; kcal: number; protein: number; cost: number; fits: boolean };

const chooseDay = (
  slots: MealSlot[],
  candidates: PlanRecipe[][],
  budget: number,
  proteinMin: number,
  used: Set<string>,
): Choice | null => {
  let best = null as Choice | null;
  const picked: PlanRecipe[] = [];
  const visit = (index: number, kcal: number, protein: number) => {
    if (index === slots.length) {
      const fits = kcal <= budget && protein >= proteinMin;
      const reuse = picked.filter((r) => used.has(r.id)).length;
      // Fitting plans: closest to the budget. Others: by how far they miss.
      const miss =
        Math.max(0, kcal - budget) / budget +
        Math.max(0, proteinMin - protein) / Math.max(proteinMin, 1);
      const cost = (fits ? (budget - kcal) / budget : 10 + miss) + reuse * REUSE_PENALTY;
      if (
        !best ||
        Number(fits) > Number(best.fits) ||
        (fits === best.fits && cost < best.cost - 1e-9)
      )
        best = { recipes: [...picked], kcal, protein, cost, fits };
      return;
    }
    for (const recipe of candidates[index]!) {
      if (picked.some((r) => r.id === recipe.id)) continue; // one recipe once a day
      picked.push(recipe);
      visit(index + 1, kcal + recipe.kcal, protein + recipe.protein);
      picked.pop();
    }
  };
  visit(0, 0, 0);
  return best;
};

/** The plan: one entry per day and slot when recipes allow, in day and slot order. */
export const suggestPlan = (input: PlanInput): PlanDayDto[] => {
  const recipes = input.recipes.filter(
    (r) => Number.isFinite(r.kcal) && r.kcal > 0 && Number.isFinite(r.protein) && r.protein >= 0,
  );
  const slots = (["breakfast", "lunch", "dinner", "snack"] as MealSlot[]).filter((s) =>
    input.slots.includes(s),
  );
  const share = slots.reduce((sum, slot) => sum + SLOT_SHARES[slot], 0);
  const budget = Math.round(input.energyTarget * share);
  const proteinMin = Math.round(input.proteinTarget * share * 10) / 10;
  const candidates = slots.map((slot) =>
    slotCandidates(recipes, input.energyTarget * SLOT_SHARES[slot]),
  );
  const used = new Set<string>();
  return [...new Set(input.days)].sort().map((date) => {
    const choice =
      slots.length && recipes.length
        ? chooseDay(slots, candidates, budget, proteinMin, used)
        : null;
    const entries: PlanEntryDto[] = (choice?.recipes ?? []).map((recipe, i) => ({
      date,
      slot: slots[i]!,
      recipeId: recipe.id,
      recipeSlug: recipe.slug,
      name: recipe.name,
      kcal: Math.round(recipe.kcal),
      protein: Math.round(recipe.protein * 10) / 10,
    }));
    for (const recipe of choice?.recipes ?? []) used.add(recipe.id);
    return {
      date,
      entries,
      kcal: Math.round(choice?.kcal ?? 0),
      protein: Math.round((choice?.protein ?? 0) * 10) / 10,
      energyBudget: budget,
      proteinMin,
      meetsTargets: !!choice?.fits,
    };
  });
};
