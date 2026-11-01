"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { SegmentedControl } from "@/components/ui/segmented-control";
import type { Theme } from "@/lib/ui/theme";

import { setThemeAction } from "./actions";

export const ThemeChoice = ({ initial }: { initial: Theme }) => {
  const [theme, setTheme] = useState(initial);
  const [, startTransition] = useTransition();
  const router = useRouter();
  return (
    <SegmentedControl
      label="Appearance"
      value={theme}
      onValueChange={(next) => {
        setTheme(next);
        if (next === "system") document.documentElement.removeAttribute("data-theme");
        else document.documentElement.setAttribute("data-theme", next);
        startTransition(async () => {
          await setThemeAction(next);
          router.refresh();
        });
      }}
      options={[
        { value: "system", label: "Automatic" },
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ]}
    />
  );
};
