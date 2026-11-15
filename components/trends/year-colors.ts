// The year card's colour classes (tokens in app/globals.css, light and dark). Literal class names
// so Tailwind finds them.
import type { DayLook, ScaleLevel, YearBin } from "@/lib/trends/year";

export const BIN_CLASS: Record<YearBin, string> = {
  far_under: "bg-year-far-under",
  under: "bg-year-under",
  on_target: "bg-year-on-target",
  over: "bg-year-over",
  well_over: "bg-year-well-over",
  far_over: "bg-year-far-over",
};

export const SCALE_CLASS: Record<ScaleLevel, string> = {
  0: "bg-year-scale-0",
  1: "bg-year-scale-1",
  2: "bg-year-scale-2",
  3: "bg-year-scale-3",
  4: "bg-year-scale-4",
};

export const NONE_CLASS = "bg-year-none";
/** Days still to come: outlined, not coloured. */
export const FUTURE_CLASS = "border-year-none border border-dashed";

export const lookClass = (look: DayLook) => {
  switch (look.state) {
    case "future":
      return FUTURE_CLASS;
    case "none":
    case "unknown":
      return NONE_CLASS;
    case "bin":
      return BIN_CLASS[look.bin];
    case "scale":
      return SCALE_CLASS[look.level];
  }
};
