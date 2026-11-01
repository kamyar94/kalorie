import { cn } from "@/components/ui/cn";
import type { NutrientCode, NutrientMap } from "@/lib/contracts/nutrients";
import { formatNutrient, NUTRIENT_CATALOGUE } from "@/lib/contracts/nutrients";
import type { NutrientTarget } from "@/lib/contracts/targets";
import { percentOf } from "@/lib/ui/format";

type Row = { code: NutrientCode; sub?: boolean };

/** The table's sections, in the order of docs/DESIGN.md section 5. */
export const NUTRIENT_SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: "Energy and macronutrients",
    rows: [
      { code: "energy" },
      { code: "protein" },
      { code: "fat" },
      ...NUTRIENT_CATALOGUE.filter((n) => n.group === "fat").map((n) => ({
        code: n.code,
        sub: true,
      })),
      { code: "carbs" },
      ...NUTRIENT_CATALOGUE.filter((n) => n.group === "carb").map((n) => ({
        code: n.code,
        sub: true,
      })),
    ],
  },
  {
    title: "Minerals",
    rows: NUTRIENT_CATALOGUE.filter((n) => n.group === "mineral").map((n) => ({ code: n.code })),
  },
  {
    title: "Vitamins",
    rows: NUTRIENT_CATALOGUE.filter((n) => n.group === "vitamin").map((n) => ({ code: n.code })),
  },
  {
    title: "Other",
    rows: NUTRIENT_CATALOGUE.filter((n) => n.group === "other").map((n) => ({ code: n.code })),
  },
];

/**
 * Every nutrient of a meal or item, grouped, with the share of the daily target where one is
 * set. Unknown values show a dash (unknown is not zero).
 */
export const NutrientTable = ({
  nutrients,
  targets,
  caption,
  className,
}: {
  nutrients: NutrientMap;
  targets?: Partial<Record<NutrientCode, NutrientTarget>>;
  caption: string;
  className?: string;
}) => (
  <div className={cn("flex flex-col gap-4", className)}>
    {NUTRIENT_SECTIONS.map((section) => (
      <table key={section.title} className="w-full border-collapse text-left">
        <caption className="text-label text-muted mb-1 text-left">
          <span className="sr-only">{caption}: </span>
          {section.title}
        </caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Nutrient</th>
            <th scope="col">Amount</th>
            <th scope="col">Share of daily target</th>
          </tr>
        </thead>
        <tbody>
          {section.rows.map(({ code, sub }) => {
            const info = NUTRIENT_CATALOGUE.find((n) => n.code === code)!;
            const value = nutrients[code];
            const known = typeof value === "number";
            return (
              <tr key={code} className="border-border border-b last:border-b-0">
                <th
                  scope="row"
                  className={cn(
                    "text-body py-2 font-normal",
                    sub && "text-muted pl-4",
                    !sub && "font-medium",
                  )}
                >
                  {info.name}
                </th>
                <td className={cn("tabular text-body py-2 text-right", !known && "text-muted")}>
                  {formatNutrient(code, value)}
                </td>
                <td className="tabular text-caption text-muted w-14 py-2 text-right">
                  {known ? percentOf(value, targets?.[code]?.target) : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    ))}
  </div>
);
