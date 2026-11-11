"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import type { MealSummaryDto } from "@/lib/contracts/meals";
import { formatDose, medicineTitle, type LoggedMedicine } from "@/lib/contracts/medicines";
import {
  listQueued,
  newClientId,
  photoBlob,
  putQueued,
  queueIsPersistent,
  removeQueued,
  type QueuedMeal,
} from "@/lib/client/capture-queue";
import { flushQueue, requestBackgroundSync } from "@/lib/client/uploader";
import { localParts, type MealWindows } from "@/lib/meals/time";
import { deviceTimeZone } from "@/lib/photos/client";
import { useOnline } from "@/lib/ui/hooks";
import { mealTime } from "@/lib/ui/when";

import { CameraScreen, type BodyCaptureResult, type Shot } from "./camera-screen";

/** A note the label photo carries, so the analysis reads the package instead of a plate. */
export const LABEL_NOTE = "Photo of a package or nutrition label: read the label.";

/**
 * meal: the camera on its Meal tab; medicine and body: on their tabs; label: a package for Add.
 */
export type CaptureMode = "meal" | "label" | "medicine" | "body";

type CaptureContextValue = {
  userId: string;
  mealWindows: MealWindows | null;
  /** Meals on this device that the server does not have yet. */
  queue: QueuedMeal[];
  /** clientIds being sent right now. */
  uploading: ReadonlySet<string>;
  /** Object URLs of the first photo of each queued meal. */
  previews: ReadonlyMap<string, string>;
  /** Meals uploaded in this page view, until the server list includes them. */
  uploaded: ReadonlyMap<string, MealSummaryDto>;
  online: boolean;
  openCamera: (mode?: CaptureMode) => void;
  retry: (clientId: string) => Promise<void>;
  discard: (clientId: string) => Promise<void>;
};

const CaptureContext = createContext<CaptureContextValue | null>(null);

export const useCapture = () => {
  const value = useContext(CaptureContext);
  if (!value) throw new Error("useCapture needs a CaptureProvider above it.");
  return value;
};

/**
 * Owns the in-app camera and the device's upload queue for the signed-in person: Send stores the
 * meal on the device first, then uploads it now or the next time the app is open and online.
 */
export const CaptureProvider = ({
  userId,
  mealWindows,
  children,
}: {
  userId: string;
  mealWindows: MealWindows | null;
  children: ReactNode;
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const { show } = useToast();
  const [queue, setQueue] = useState<QueuedMeal[]>([]);
  const [uploading, setUploading] = useState<ReadonlySet<string>>(new Set());
  const [uploaded, setUploaded] = useState<ReadonlyMap<string, MealSummaryDto>>(new Map());
  const online = useOnline();
  const [camera, setCamera] = useState<{ open: boolean; mode: CaptureMode }>({
    open: false,
    mode: "meal",
  });
  const previewsRef = useRef(new Map<string, string>());
  const [previews, setPreviews] = useState<ReadonlyMap<string, string>>(new Map());
  const flushing = useRef(false);

  const reload = useCallback(async () => {
    const list = await listQueued(userId);
    const urls = previewsRef.current;
    for (const [clientId, url] of urls)
      if (!list.some((m) => m.clientId === clientId)) {
        URL.revokeObjectURL(url);
        urls.delete(clientId);
      }
    for (const meal of list)
      if (!urls.has(meal.clientId) && meal.photos[0])
        urls.set(meal.clientId, URL.createObjectURL(photoBlob(meal.photos[0])));
    setPreviews(new Map(urls));
    setQueue(list);
    return list;
  }, [userId]);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      const sent = await flushQueue(userId, {
        onUploading: (clientId) => setUploading((s) => new Set(s).add(clientId)),
        onUploaded: (clientId, response) => {
          setUploaded((m) => new Map(m).set(clientId, response.meal));
          // The refreshed server list has it by then (and a deleted meal must not come back).
          window.setTimeout(
            () =>
              setUploaded((m) => {
                const next = new Map(m);
                next.delete(clientId);
                return next;
              }),
            15_000,
          );
        },
        onSettled: (clientId) =>
          setUploading((s) => {
            const next = new Set(s);
            next.delete(clientId);
            return next;
          }),
      });
      await reload();
      if (sent) router.refresh();
    } finally {
      flushing.current = false;
    }
  }, [reload, router, userId]);

  useEffect(() => {
    const urls = previewsRef.current;
    void reload().then((list) => {
      if (list.length) void flush();
    });
    const onOnline = () => void flush();
    const onVisible = () => {
      if (document.visibilityState === "visible")
        void reload().then((l) => {
          if (l.length) void flush();
        });
    };
    // The service worker tells open pages when it sent meals in the background.
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === "cal-queue-changed") {
        void reload();
        router.refresh();
      }
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    // A meal can be due again after a server hiccup (backoff); check now and then.
    const timer = window.setInterval(() => {
      if (navigator.onLine && document.visibilityState === "visible")
        void reload().then((l) => {
          if (l.some((m) => m.state === "waiting")) void flush();
        });
    }, 30_000);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      window.clearInterval(timer);
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, [flush, reload, router]);

  const send = useCallback(
    async (shots: Shot[], note: string, mode: CaptureMode, chosenAt: Date | null) => {
      // Photos, or a meal described in words (a label photo always needs its photo).
      if (!shots.length && (mode === "label" || !note.trim())) return;
      const photos = await Promise.all(
        shots.map(async (shot) => ({
          type: shot.blob.type || "image/jpeg",
          data: await shot.blob.arrayBuffer(),
          width: shot.width,
          height: shot.height,
        })),
      );
      const text = [mode === "label" ? LABEL_NOTE : "", note.trim()].filter(Boolean).join(" ");
      const tz = deviceTimeZone();
      const eatenAt = mealTime(chosenAt, shots[0]?.capturedAt ?? null, new Date());
      const meal: QueuedMeal = {
        clientId: newClientId(),
        userId,
        createdAt: Date.now(),
        eatenAt: eatenAt.toISOString(),
        tz,
        note: text,
        photos,
        state: "waiting",
        attempts: 0,
        error: null,
        nextAttemptAt: 0,
      };
      await putQueued(meal);
      await reload();
      if (!(await queueIsPersistent()))
        show({
          title: "Keep Kal open until the meal is sent",
          body: "This browser cannot store meals for later.",
          tone: "neutral",
        });
      // Show the new card on its day: Today, or the earlier day it was eaten on.
      const day = localParts(eatenAt, tz).date;
      const target = day === localParts(new Date(), tz).date ? "/today" : `/today?date=${day}`;
      if (`${pathname}${window.location.search}` !== target) router.push(target);
      void requestBackgroundSync();
      void flush();
    },
    [flush, pathname, reload, router, show, userId],
  );

  const retry = useCallback(
    async (clientId: string) => {
      const meal = queue.find((m) => m.clientId === clientId);
      if (!meal) return;
      await putQueued({ ...meal, state: "waiting", error: null, nextAttemptAt: 0 });
      await reload();
      void flush();
    },
    [flush, queue, reload],
  );

  const discard = useCallback(
    async (clientId: string) => {
      await removeQueued(clientId);
      await reload();
    },
    [reload],
  );

  // A medicine was logged from the camera: show it on its day (the Medicines page stays put),
  // with Undo.
  const medicineSaved = useCallback(
    ({ log }: LoggedMedicine) => {
      setCamera((c) => ({ ...c, open: false }));
      const today = localParts(new Date(), deviceTimeZone()).date;
      const target = log.localDate === today ? "/today" : `/today?date=${log.localDate}`;
      if (pathname.startsWith("/medicines") || `${pathname}${window.location.search}` === target)
        router.refresh();
      else router.push(target);
      show({
        title: `${medicineTitle(log)} logged`,
        body: `${formatDose(log.amount, log.unit)} at ${log.localTime}`,
        tone: "success",
        action: {
          label: "Undo",
          onClick: () =>
            void api
              .deleteMedicineLog(log.id)
              .then(() => router.refresh())
              .catch((error) =>
                show({ title: "Not undone", body: (error as Error).message, tone: "error" }),
              ),
        },
      });
    },
    [pathname, router, show],
  );

  // Body photos are saved: Body shows them (unless the camera was closed part-way).
  const bodyDone = useCallback(
    ({ saved, failed, skipped, closed }: BodyCaptureResult) => {
      setCamera((c) => ({ ...c, open: false }));
      if (saved && !closed) {
        if (pathname === "/body") router.refresh();
        else router.push("/body");
      } else if (saved && pathname.startsWith("/body")) router.refresh();
      const counted = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;
      show({
        title: saved ? `${counted(saved, "body photo")} saved` : "No body photos saved",
        body:
          [
            failed ? `${counted(failed, "photo")} could not be saved; take it again.` : "",
            skipped ? `${counted(skipped, "pose")} skipped.` : "",
          ]
            .filter(Boolean)
            .join(" ") || undefined,
        tone: failed ? "error" : "success",
      });
    },
    [pathname, router, show],
  );

  const openCamera = useCallback((mode: CaptureMode = "meal") => {
    setCamera({ open: true, mode });
  }, []);

  const value = useMemo<CaptureContextValue>(
    () => ({
      userId,
      mealWindows,
      queue,
      uploading,
      previews,
      uploaded,
      online,
      openCamera,
      retry,
      discard,
    }),
    [userId, mealWindows, queue, uploading, previews, uploaded, online, openCamera, retry, discard],
  );

  return (
    <CaptureContext.Provider value={value}>
      {children}
      <CameraScreen
        open={camera.open}
        mode={camera.mode}
        onClose={() => setCamera((c) => ({ ...c, open: false }))}
        onMedicineSaved={medicineSaved}
        onBodyDone={bodyDone}
        onSend={(shots, note, at) => {
          const mode = camera.mode;
          setCamera((c) => ({ ...c, open: false }));
          void send(shots, note, mode, at).catch(() =>
            show({
              title: "The meal could not be saved on this device",
              body: "Try again, or pick the photos from the gallery.",
              tone: "error",
              duration: 0,
            }),
          );
        }}
      />
    </CaptureContext.Provider>
  );
};
