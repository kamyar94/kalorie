"use client";

import { Download, Share, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "cal.install-hint.dismissed";

const readDismissed = () => {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
};

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIosSafari = () => {
  const ua = navigator.userAgent;
  const ios =
    /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
};

/**
 * Suggests installing Cal: the browser's own install prompt where there is one (Chromium), and the
 * Share, Add to Home Screen steps on iPhone and iPad, where web push and a full-screen camera need
 * the installed app. Hidden once installed or dismissed.
 */
export const InstallHint = () => {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (isStandalone() || readDismissed()) return;
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
      setHidden(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const timer = window.setTimeout(() => {
      if (isIosSafari()) {
        setIos(true);
        setHidden(false);
      }
    }, 0);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.clearTimeout(timer);
    };
  }, []);

  if (hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Private mode: the hint simply shows again next time.
    }
  };

  return (
    <aside
      aria-label="Install Cal"
      className="animate-fade-in border-border bg-surface shadow-raised fixed inset-x-3 top-[max(env(safe-area-inset-top),0.75rem)] z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border p-3 md:right-6 md:left-auto"
    >
      <div className="bg-primary-soft text-on-primary-soft grid size-10 shrink-0 place-items-center rounded-xl">
        {ios ? (
          <Share aria-hidden className="size-5" />
        ) : (
          <Download aria-hidden className="size-5" />
        )}
      </div>
      <p className="text-caption min-w-0 flex-1">
        {ios ? (
          <>
            <span className="text-label block">Add Cal to your Home Screen</span>
            Tap Share, then Add to Home Screen.
          </>
        ) : (
          <>
            <span className="text-label block">Install Cal</span>
            Opens like an app, straight to the camera.
          </>
        )}
      </p>
      {prompt && (
        <Button
          size="md"
          onClick={async () => {
            await prompt.prompt();
            await prompt.userChoice.catch(() => undefined);
            dismiss();
          }}
        >
          Install
        </Button>
      )}
      <button
        type="button"
        aria-label="Hide this hint"
        onClick={dismiss}
        className="text-muted hover:bg-surface-2 grid size-11 shrink-0 place-items-center rounded-full"
      >
        <X aria-hidden className="size-5" />
      </button>
    </aside>
  );
};
