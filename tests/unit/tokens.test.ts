// WCAG AA contrast of the design tokens in app/globals.css, in both themes: text 4.5:1, large
// numbers and chart colours 3:1 against the surfaces they sit on.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(import.meta.dirname, "../../app/globals.css"), "utf8");

const block = (selector: string) => {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`No ${selector} block`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return Object.fromEntries(
    [...css.slice(open + 1, close).matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [
      m[1]!,
      m[2]!,
    ]),
  );
};

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const themes = { light: block(":root {"), dark: block(':root[data-theme="dark"]') };

const TEXT_PAIRS: [string, string][] = [
  ["text", "bg"],
  ["text", "surface"],
  ["text", "surface-2"],
  ["text-muted", "bg"],
  ["text-muted", "surface"],
  ["text-muted", "surface-2"],
  ["on-primary", "primary"],
  ["on-primary-soft", "primary-soft"],
  ["on-danger", "danger"],
  ["on-danger-soft", "danger-soft"],
  ["on-warning-soft", "warning-soft"],
  ["on-warning-soft", "surface"],
  ["danger", "surface"],
  ["primary", "surface"],
  // "+250 ml water" on a meal card.
  ["water", "surface"],
  ["water", "bg"],
];

const GRAPHIC_PAIRS: [string, string][] = [
  "energy",
  "protein",
  "carbs",
  "fat",
  "fiber",
  "focus",
  "water",
].flatMap((c): [string, string][] => [
  [c, "surface"],
  [c, "bg"],
]);

// The water bar fills a surface-2 track.
GRAPHIC_PAIRS.push(["water", "surface-2"]);

describe.each(Object.entries(themes))("%s theme", (_name, tokens) => {
  it.each(TEXT_PAIRS)("%s on %s reaches 4.5:1", (fg, bg) => {
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(GRAPHIC_PAIRS)("%s on %s reaches 3:1", (fg, bg) => {
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(3);
  });
});

describe("theme blocks", () => {
  it("defines the same tokens for system dark mode and the explicit dark choice", () => {
    const system = block(':root:not([data-theme="light"])');
    expect(system).toEqual(themes.dark);
    expect(Object.keys(themes.light).sort()).toEqual(Object.keys(themes.dark).sort());
  });
});
