"use client";

import { CalendarDays, Loader2, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/client/api";
import type { FoodResult } from "@/lib/contracts/food-search";
import type { MealieRecipeHit } from "@/lib/contracts/integrations";

import { FoodRow } from "./food-row";

/**
 * A search field with results as you type (debounced). While the field is empty it shows
 * `idle` (recent and frequent foods on the Add screen); with no results it shows `empty`.
 * When Mealie is connected its recipes are listed under the foods; picking one imports it
 * (nutrition from Mealie, or computed from its ingredients) and hands its food to onPick.
 */
export const FoodSearch = ({
  onPick,
  idle,
  empty,
  label = "Search foods",
  autoFocus,
  onQueryChange,
}: {
  onPick: (food: FoodResult) => void;
  idle?: ReactNode;
  empty?: (query: string) => ReactNode;
  label?: string;
  autoFocus?: boolean;
  onQueryChange?: (query: string) => void;
}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodResult[] | null>(null);
  const [recipes, setRecipes] = useState<MealieRecipeHit[]>([]);
  const [opening, setOpening] = useState<string | null>(null);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();

  // Loading is set where the query changes; the effect only fetches.
  useEffect(() => {
    const text = query.trim();
    if (!text) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api
        .searchAll(text, controller.signal)
        .then(({ foods, recipes: found }) => {
          setResults(foods);
          setRecipes(found);
          setRecipeError(null);
          setError(null);
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") setError(err.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  const changeQuery = (value: string) => {
    setQuery(value);
    setLoading(!!value.trim());
    if (!value.trim()) {
      setResults(null);
      setRecipes([]);
    }
    onQueryChange?.(value);
  };

  const count = (results?.length ?? 0) + recipes.length;

  const pickRecipe = async (recipe: MealieRecipeHit) => {
    setOpening(recipe.slug);
    setRecipeError(null);
    try {
      const info = await api.mealieRecipe(recipe.slug);
      if (info.food) onPick(info.food);
      else
        setRecipeError(
          `Cal could not work out the nutrition of ${info.name}. Add its foods one by one.`,
        );
    } catch (err) {
      setRecipeError((err as Error).message);
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <Search
          aria-hidden
          className="text-muted pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2"
        />
        <input
          ref={input}
          id={id}
          type="search"
          dir="auto"
          autoComplete="off"
          enterKeyHint="search"
          autoFocus={autoFocus}
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          placeholder="Search foods, in English or Persian"
          aria-describedby={`${id}-status`}
          className="border-border bg-surface text-body placeholder:text-muted focus:border-primary min-h-12 w-full rounded-full border pr-12 pl-11 focus:outline-none focus-visible:outline-3 focus-visible:outline-offset-0 focus-visible:outline-[var(--focus)] [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear the search"
            onClick={() => {
              changeQuery("");
              input.current?.focus();
            }}
            className="text-muted hover:bg-surface-2 absolute top-1/2 right-0.5 grid size-11 -translate-y-1/2 place-items-center rounded-full"
          >
            <X aria-hidden className="size-5" />
          </button>
        )}
      </div>
      <p id={`${id}-status`} className="sr-only" aria-live="polite">
        {query.trim() && !loading ? `${count} ${count === 1 ? "food" : "foods"} found` : ""}
      </p>

      {!query.trim() ? (
        idle
      ) : loading && !results ? (
        <div className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <p role="alert" className="text-body text-danger">
          {error}
        </p>
      ) : count ? (
        <>
          {!!results?.length && (
            <ul aria-label="Search results" className="flex flex-col gap-1">
              {results.map((food) => (
                <li key={food.id}>
                  <FoodRow food={food} onPick={() => onPick(food)} />
                </li>
              ))}
            </ul>
          )}
          {recipes.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-caption text-muted mt-1 px-1">Recipes from Mealie</h3>
              <ul aria-label="Mealie recipes" className="flex flex-col gap-1">
                {recipes.map((recipe) => (
                  <li key={recipe.id}>
                    <button
                      type="button"
                      onClick={() => void pickRecipe(recipe)}
                      disabled={!!opening}
                      className="hover:bg-surface-2 flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 text-left"
                    >
                      <span
                        aria-hidden
                        className="bg-surface-2 grid size-10 shrink-0 place-items-center rounded-full"
                      >
                        {opening === recipe.slug ? (
                          <Loader2 className="size-5 animate-spin motion-reduce:animate-none" />
                        ) : (
                          <CalendarDays className="size-5" />
                        )}
                      </span>
                      <span className="text-label min-w-0 flex-1 truncate" dir="auto">
                        {recipe.name}
                      </span>
                      <span className="text-caption text-muted">Mealie</span>
                    </button>
                  </li>
                ))}
              </ul>
              {recipeError && (
                <p role="alert" className="text-caption text-danger px-1">
                  {recipeError}
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        (empty?.(query.trim()) ?? (
          <p className="text-body text-muted py-4 text-center">No foods found.</p>
        ))
      )}
    </div>
  );
};
