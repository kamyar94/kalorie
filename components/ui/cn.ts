import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge must know Kal's own type scale (app/globals.css), or it takes text-headline for
// a colour and drops text-on-primary next to it.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display", "title", "headline", "body", "label", "caption"],
    },
  },
});

/** Joins class names; later Tailwind classes win over earlier ones. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
