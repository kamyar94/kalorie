// Web Push in the browser (CONTRACT: lib/contracts/integrations.ts). The settings switches call
// these: enablePush asks for permission, subscribes this device with the server's VAPID key
// (GET /api/push/key) and stores the subscription (POST /api/push/subscriptions); disablePush
// removes it on the server and in the browser.
//
// Browser only: import from client components.
import type { PushResult, PushSupport } from "@/lib/contracts/integrations";

/** Whether this browser could receive notifications from Kal. */
export const pushSupport = (): PushSupport => {
  if (typeof window === "undefined") return "unsupported";
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (ios && !standalone) return "needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
    return "unsupported";
  return "supported";
};

const keyBytes = (base64url: string) => {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

const send = async (method: "POST" | "DELETE", body: unknown) => {
  const response = await fetch("/api/push/subscriptions", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(error?.error ?? "The server did not save this device.");
  }
};

/** A service worker registration, waiting at most a few seconds for it. */
const registration = async () =>
  Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
  ]);

/** Asks for permission and subscribes this device. */
export const enablePush = async (): Promise<PushResult> => {
  if (pushSupport() !== "supported")
    return { ok: false, message: "This browser cannot show notifications from Kal." };
  try {
    const keyResponse = await fetch("/api/push/key", { credentials: "same-origin" });
    if (!keyResponse.ok)
      return { ok: false, message: "Notifications are not set up on this server." };
    const { publicKey } = (await keyResponse.json()) as { publicKey: string };
    const permission =
      Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted")
      return {
        ok: false,
        message: "Notifications are blocked for Kal. Allow them in the browser's site settings.",
      };
    const ready = await registration();
    if (!ready) return { ok: false, message: "Reload the page and try again." };
    const subscription =
      (await ready.pushManager.getSubscription()) ??
      (await ready.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      }));
    await send("POST", subscription.toJSON());
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "This device could not be subscribed.",
    };
  }
};

/** Removes this device's subscription. */
export const disablePush = async (): Promise<PushResult> => {
  if (!("serviceWorker" in navigator)) return { ok: true };
  try {
    const ready = await registration();
    const subscription = ready ? await ready.pushManager.getSubscription() : null;
    if (subscription) {
      await send("DELETE", { endpoint: subscription.endpoint });
      await subscription.unsubscribe().catch(() => undefined);
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "This device could not be removed.",
    };
  }
};
