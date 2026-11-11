"use client";

import { useState } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { api } from "@/lib/client/api";
import type { FoodResult } from "@/lib/contracts/food-search";
import type { NutrientCode } from "@/lib/contracts/nutrients";

const VALUES: { code: NutrientCode; label: string; unit: string }[] = [
  { code: "energy", label: "Calories", unit: "kcal" },
  { code: "protein", label: "Protein", unit: "g" },
  { code: "carbs", label: "Carbohydrate", unit: "g" },
  { code: "sugars", label: "of which sugars", unit: "g" },
  { code: "fiber", label: "Fiber", unit: "g" },
  { code: "fat", label: "Fat", unit: "g" },
  { code: "fat_sat", label: "of which saturated", unit: "g" },
  { code: "sodium", label: "Sodium", unit: "mg" },
];

const empty = () =>
  Object.fromEntries(VALUES.map((v) => [v.code, ""])) as Record<NutrientCode, string>;

/**
 * A food of the person's own (home recipes, a product Kal does not know), from the numbers on a
 * label or a recipe: per 100 g or per serving.
 */
export const CustomFoodSheet = ({
  open,
  barcode,
  name,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  barcode?: string | null;
  name?: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (food: FoodResult) => void;
}) => {
  const [nameEn, setNameEn] = useState("");
  const [nameFa, setNameFa] = useState("");
  const [brand, setBrand] = useState("");
  const [code, setCode] = useState("");
  const [per, setPer] = useState<"100g" | "serving">("100g");
  const [serving, setServing] = useState("");
  const [values, setValues] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setNameEn(name ?? "");
      setNameFa("");
      setBrand("");
      setCode(barcode ?? "");
      setPer("100g");
      setServing("");
      setValues(empty());
      setError(null);
    }
  }

  const number = (text: string) => {
    const n = Number(text.replace(",", "."));
    return text.trim() && Number.isFinite(n) ? n : undefined;
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const nutrients: Record<string, number> = {};
      for (const v of VALUES) {
        const n = number(values[v.code]);
        if (n !== undefined) nutrients[v.code] = n;
      }
      const food = await api.createFood({
        nameEn,
        nameFa: nameFa || null,
        brand: brand || null,
        barcode: code || null,
        servingGrams: number(serving) ?? null,
        per,
        nutrients,
      });
      onCreated(food);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The food was not saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New food"
      description="Only you see the foods you add."
      footer={
        <Button fullWidth size="lg" loading={busy} onClick={() => void save()}>
          Save food
        </Button>
      }
    >
      <form
        className="flex flex-col gap-4 py-1"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field
          label="Name"
          dir="auto"
          required
          value={nameEn}
          onChange={(e) => setNameEn(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Persian name (optional)"
            dir="auto"
            lang="fa"
            value={nameFa}
            onChange={(e) => setNameFa(e.target.value)}
          />
          <Field
            label="Brand (optional)"
            dir="auto"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          />
        </div>
        <Field
          label="Barcode (optional)"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-label">The numbers below are</span>
          <SegmentedControl
            label="The numbers below are"
            value={per}
            onValueChange={setPer}
            options={[
              { value: "100g", label: "Per 100 g" },
              { value: "serving", label: "Per serving" },
            ]}
          />
        </div>
        <Field
          label={per === "serving" ? "Serving size (g)" : "Serving size (g, optional)"}
          inputMode="decimal"
          value={serving}
          onChange={(e) => setServing(e.target.value.replace(/[^\d.,]/g, ""))}
        />
        <fieldset className="grid min-w-0 grid-cols-2 gap-3">
          <legend className="text-label mb-2">Nutrition facts</legend>
          {VALUES.map((v) => (
            <Field
              key={v.code}
              label={`${v.label} (${v.unit})`}
              inputMode="decimal"
              required={v.code === "energy"}
              value={values[v.code]}
              onChange={(e) =>
                setValues((all) => ({ ...all, [v.code]: e.target.value.replace(/[^\d.,]/g, "") }))
              }
            />
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </BottomSheet>
  );
};
