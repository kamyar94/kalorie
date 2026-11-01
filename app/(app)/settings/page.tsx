import { ChevronRight, LogOut, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { signOutAction } from "@/app/(auth)/actions";
import { AiSection } from "@/components/settings/ai-section";
import { DataSection } from "@/components/settings/data-section";
import { IntegrationsSection } from "@/components/settings/integrations-section";
import { NotificationsSection } from "@/components/settings/notifications-section";
import { PreferencesSection } from "@/components/settings/preferences-section";
import { ProfileSection } from "@/components/settings/profile-section";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getPreferences } from "@/lib/account/settings";
import { DEFAULT_MODELS, SUGGESTED_MODELS } from "@/lib/ai/config";
import { getKeyViews, getTaskSettings, getUsageSummary } from "@/lib/ai/service";
import { AI_PROVIDERS, AI_TASKS } from "@/lib/ai/types";
import { requireUser } from "@/lib/auth/session";
import { getIntegrationStatuses } from "@/lib/integrations/day";
import { pushConfigured } from "@/lib/push/config";
import { getProfile, getTargets } from "@/lib/targets/service";
import { parseTheme, THEME_COOKIE } from "@/lib/ui/theme";

import { ThemeChoice } from "./theme-choice";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const [preferences, profile, targets, keys, tasks, usage, integrations] = await Promise.all([
    getPreferences(user.id),
    getProfile(user.id),
    getTargets(user.id),
    getKeyViews(user.id),
    getTaskSettings(user.id),
    getUsageSummary(user.id),
    getIntegrationStatuses(user.id),
  ]);
  const units = preferences?.units ?? "metric";

  return (
    <>
      <h1 className="text-title">Settings</h1>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
        <div className="flex flex-col gap-4">
          <ProfileSection
            profile={
              profile ?? {
                sex: null,
                birthYear: null,
                heightCm: null,
                weightKg: null,
                activityLevel: null,
                goal: null,
                goalRateKgPerWeek: null,
              }
            }
            initialTargets={targets}
            units={units}
          />
          {preferences && (
            <PreferencesSection
              initial={{
                timeZone: preferences.timeZone,
                units: preferences.units,
                mealWindows: preferences.mealWindows,
                cuisines: preferences.cuisines,
              }}
            />
          )}
          <NotificationsSection
            initial={preferences?.notifications ?? { analysisReady: false, questions: false }}
            configured={pushConfigured()}
          />
        </div>
        <div className="flex flex-col gap-4">
          <AiSection
            keys={AI_PROVIDERS.map((p) => keys[p])}
            tasks={AI_TASKS.map((t) => tasks[t])}
            usage={usage}
            suggestions={SUGGESTED_MODELS}
            defaults={DEFAULT_MODELS}
          />
          <IntegrationsSection statuses={integrations} />
          <Card as="section" aria-labelledby="appearance-heading">
            <h2 id="appearance-heading" className="text-headline mb-3">
              Appearance
            </h2>
            <ThemeChoice initial={theme} />
          </Card>
          <DataSection />
          <Card as="section" aria-labelledby="account-heading">
            <h2 id="account-heading" className="text-headline">
              Account
            </h2>
            <dl className="text-body mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
              <dt className="text-muted">Name</dt>
              <dd dir="auto" className="wrap-break-word">
                {user.displayName}
              </dd>
              <dt className="text-muted">Username</dt>
              <dd className="wrap-break-word">{user.username}</dd>
              <dt className="text-muted">Role</dt>
              <dd>{user.role === "admin" ? "Admin" : "Member"}</dd>
            </dl>
            {user.role === "admin" && (
              <Link
                href="/admin"
                className="bg-surface-2 hover:bg-surface-3 text-label mt-4 flex min-h-12 items-center gap-3 rounded-2xl px-4"
              >
                <ShieldCheck aria-hidden className="text-primary size-5" />
                <span className="flex-1">Admin: invites, accounts and usage</span>
                <ChevronRight aria-hidden className="text-muted size-5" />
              </Link>
            )}
          </Card>
          <form action={signOutAction}>
            <Button type="submit" variant="secondary" size="lg" fullWidth>
              <LogOut aria-hidden className="size-5" /> Sign out
            </Button>
          </form>
        </div>
      </div>
    </>
  );
}
