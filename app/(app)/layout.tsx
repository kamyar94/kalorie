import type { ReactNode } from "react";

import { AppShell } from "@/components/app/app-shell";
import { DeviceTimeZone } from "@/components/app/device-time-zone";
import { CaptureProvider } from "@/components/capture/capture-provider";
import { getPreferences } from "@/lib/account/settings";
import { requireUser } from "@/lib/auth/session";

export default async function SignedInLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const preferences = await getPreferences(user.id);
  return (
    <CaptureProvider userId={user.id} mealWindows={preferences?.mealWindows ?? null}>
      <AppShell>
        <DeviceTimeZone />
        {children}
      </AppShell>
    </CaptureProvider>
  );
}
