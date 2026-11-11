import type { ReactNode } from "react";

import { BottomNav } from "./bottom-nav";
import { InstallHint } from "./install-hint";

/**
 * The signed-in layout: content in a readable column (phone first, 360 to 430 px; two columns
 * are up to each screen on wide displays), the navigation with the camera in it, and room at the
 * bottom for the nav bar so nothing hides behind it.
 */
export const AppShell = ({ children }: { children: ReactNode }) => (
  <div className="min-h-dvh md:pl-24">
    <main
      id="main"
      className="mx-auto w-full max-w-5xl px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-[calc(var(--spacing-nav)+env(safe-area-inset-bottom)+2rem)] md:px-8 md:pb-16"
    >
      {children}
    </main>
    <InstallHint />
    <BottomNav />
  </div>
);
