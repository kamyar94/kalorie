"use client";

import { useState, useSyncExternalStore } from "react";

import { savePreferencesAction } from "@/app/(app)/settings/actions";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { PushSupport } from "@/lib/contracts/integrations";
import { disablePush, enablePush, pushSupport } from "@/lib/push/client";

const noSubscribe = () => () => undefined;

type Prefs = { analysisReady: boolean; questions: boolean };

const SUPPORT_TEXT: Record<PushSupport, string> = {
  supported: "",
  "needs-install":
    "On iPhone and iPad, add Kal to the Home Screen first (Share, Add to Home Screen), then turn notifications on from there.",
  unsupported: "This browser cannot show notifications from Kal.",
};

/**
 * Notifications are off until the person turns them on. Turning the first one on asks the
 * browser for permission and subscribes this device (lib/push/client.ts); the choices are saved
 * with the account.
 */
export const NotificationsSection = ({
  initial,
  configured,
}: {
  initial: Prefs;
  /** The server has VAPID keys (docs/DESIGN.md section 9). */
  configured: boolean;
}) => {
  const { show } = useToast();
  const [prefs, setPrefs] = useState(initial);
  const browser = useSyncExternalStore<PushSupport>(noSubscribe, pushSupport, () => "supported");
  const support: PushSupport = configured ? browser : "unsupported";
  const [busy, setBusy] = useState(false);

  const change = async (key: keyof Prefs, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setBusy(true);
    try {
      const wasOn = prefs.analysisReady || prefs.questions;
      const nowOn = next.analysisReady || next.questions;
      if (nowOn && !wasOn) {
        const result = await enablePush();
        if (!result.ok)
          return show({
            title: "Notifications are not on",
            body: result.message,
            tone: "error",
          });
      }
      if (!nowOn && wasOn) await disablePush();
      const saved = await savePreferencesAction({ notifications: next });
      if (!saved.ok) return show({ title: "Not saved", body: saved.error, tone: "error" });
      setPrefs(saved.data.notifications);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card as="section" aria-labelledby="notify-heading" className="flex flex-col gap-2">
      <h2 id="notify-heading" className="text-headline">
        Notifications
      </h2>
      {!configured ? (
        <p className="text-caption text-muted" data-testid="push-support">
          Notifications are not set up on this server.
        </p>
      ) : (
        support !== "supported" && (
          <p className="text-caption text-muted" data-testid="push-support">
            {SUPPORT_TEXT[support]}
          </p>
        )
      )}
      <Switch
        label="When the analysis is ready"
        checked={prefs.analysisReady}
        disabled={busy || support !== "supported"}
        onChange={(value) => void change("analysisReady", value)}
      />
      <Switch
        label="When Kal has a question about a meal"
        checked={prefs.questions}
        disabled={busy || support !== "supported"}
        onChange={(value) => void change("questions", value)}
      />
    </Card>
  );
};
