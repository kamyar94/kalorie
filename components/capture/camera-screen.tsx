"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowRight,
  Camera,
  CaseSensitive,
  Check,
  ChevronDown,
  Clock,
  ImageIcon,
  Mic,
  Pill,
  RefreshCcw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { MedicineCapture } from "@/components/medicines/medicine-capture";
import { cn } from "@/components/ui/cn";
import { startDictation, speechSupported, type Dictation } from "@/lib/client/speech";
import { UPLOAD_LIMITS } from "@/lib/contracts/meals";
import type { LoggedMedicine } from "@/lib/contracts/medicines";
import { deviceTimeZone, preparePhoto } from "@/lib/photos/client";
import { useOnline } from "@/lib/ui/hooks";
import { whenLabel, whenSpoken } from "@/lib/ui/when";

import { CaptureTabs, captureTabId, type CaptureKind } from "./capture-tabs";
import { WhenSheet } from "./when-sheet";

export type Shot = {
  id: string;
  blob: Blob;
  url: string;
  width: number;
  height: number;
  /** When the photo was taken (the shutter press, or the gallery photo's EXIF time). */
  capturedAt: Date;
};

type CameraState = "starting" | "live" | "unavailable" | "denied";

const MAX = UPLOAD_LIMITS.maxPhotos;
/** A press shorter than this is a tap (type the note); longer is hold-to-talk. */
const HOLD_MS = 280;

/** After this long without a picture, the phone's own camera is offered next to the live one. */
const SLOW_START_MS = 4000;
/** How long an opened camera may take to show its first frame before Cal tries the next way. */
const FIRST_FRAME_MS = 5000;
/** How long a full sensor photo may take before Cal uses the video frame instead. */
const STILL_MS = 4000;

/**
 * The ways to open the camera, tried in order. The live picture only needs to be sharp enough to
 * aim (stills come from takePhoto or are resized to 2048 px anyway); asking older phones for a
 * very large one can leave the picture black.
 */
const cameraRequests = (facing: "environment" | "user"): MediaTrackConstraints[] => [
  { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } },
  { facingMode: { ideal: facing } },
];

type ImageCaptureLike = { takePhoto: () => Promise<Blob> };
type ImageCaptureConstructor = new (track: MediaStreamTrack) => ImageCaptureLike;

/**
 * A phone can refuse a new camera stream for a moment right after the last one stopped
 * (NotReadableError on Android), so a quick reopen waits this long after the last stop.
 */
const REOPEN_GAP_MS = 300;
/** When this page last stopped a camera stream (performance.now()). */
let lastStoppedAt = -Infinity;

const stopStream = (stream: MediaStream | null) => {
  if (!stream) return;
  stream.getTracks().forEach((t) => t.stop());
  lastStoppedAt = performance.now();
};

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Waits until a stream stopped just now has let go of the camera. */
const settleAfterStop = async () => {
  const since = performance.now() - lastStoppedAt;
  if (since >= REOPEN_GAP_MS) return;
  await nextFrame();
  await wait(Math.max(0, REOPEN_GAP_MS - (performance.now() - lastStoppedAt)));
};

/** Errors that mean the camera is busy for a moment rather than missing or refused. */
const BUSY_ERRORS = new Set(["NotReadableError", "AbortError", "TrackStartError"]);

/** The promise's value, or null if it takes longer than `ms`. */
const within = <T,>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<null>((resolve) => window.setTimeout(resolve, ms, null))]);

/** Resolves once the video has a frame to show. */
const firstFrame = (video: HTMLVideoElement) =>
  new Promise<true>((resolve) => {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0)
      return resolve(true);
    video.addEventListener("loadeddata", () => resolve(true), { once: true });
  });

/** One still from the live camera: the full sensor photo where the browser offers it. */
const grabStill = async (video: HTMLVideoElement, stream: MediaStream): Promise<Blob> => {
  const track = stream.getVideoTracks()[0];
  const Ctor = (globalThis as unknown as { ImageCapture?: ImageCaptureConstructor }).ImageCapture;
  if (track && Ctor) {
    try {
      // Some older phones never finish takePhoto; the video frame is good enough then.
      const blob = await within(new Ctor(track).takePhoto(), STILL_MS);
      if (blob && blob.size > 0) return blob;
    } catch {
      // Fall back to the video frame.
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92),
  );
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error("The photo could not be taken.");
  return blob;
};

const newId = () => Math.random().toString(36).slice(2, 10);

const sideButton =
  "flex min-h-16 w-[3.375rem] flex-col items-center justify-center gap-1 rounded-2xl text-[0.6875rem] leading-none font-semibold disabled:opacity-40";

/**
 * The full-screen in-app camera (docs/DESIGN.md section 3): shutter, up to three thumbnails (tap
 * to remove), gallery, hold-to-talk note with tap-to-type, the meal's time (the When chip), Send
 * and close. "Type" switches to a meal described in words: the camera stops and a large text
 * field takes its place; Send then works with words alone. Without camera access it offers the
 * phone's own camera through a file input instead.
 *
 * Above the shutter, "Meal · Medicine" (capture-tabs.tsx) switches what is captured. Medicine
 * takes one photo of a box or blister (or one from the gallery); the person's AI provider reads
 * it and the medicine sheet opens to check and save it ("Type" opens the sheet empty).
 */
export const CameraScreen = ({
  open,
  mode,
  onClose,
  onSend,
  onMedicineSaved,
}: {
  open: boolean;
  /** label: a package photo for the Add screen (no tabs); medicine opens on the Medicine tab. */
  mode: "meal" | "label" | "medicine";
  onClose: () => void;
  /** at: the time chosen with the When chip, null for the photo's own time (or now). */
  onSend: (shots: Shot[], note: string, at: Date | null) => void;
  onMedicineSaved: (logged: LoggedMedicine) => void;
}) => {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const shutter = useRef<HTMLButtonElement>(null);
  const fallbackButton = useRef<HTMLButtonElement>(null);
  const sendButton = useRef<HTMLButtonElement>(null);
  const systemCamera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const noteField = useRef<HTMLTextAreaElement>(null);
  const mealText = useRef<HTMLTextAreaElement>(null);
  const whenChip = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<CameraState>("starting");
  const [slow, setSlow] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [canFlip, setCanFlip] = useState(false);
  const [shots, setShots] = useState<Shot[]>([]);
  const [note, setNote] = useState("");
  const [typing, setTyping] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [when, setWhen] = useState<Date | null>(null);
  const [whenOpen, setWhenOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [kind, setKind] = useState<CaptureKind>(mode === "medicine" ? "medicine" : "meal");
  /** Medicine mode: the label photo being read (or null with typing for the empty sheet). */
  const [medicine, setMedicine] = useState<{
    key: number;
    blob: Blob | null;
    url: string | null;
  } | null>(null);
  const online = useOnline();
  const dictation = useRef<Dictation | null>(null);
  const hold = useRef<{ timer: number | null; active: boolean; suppressClick: boolean }>({
    timer: null,
    active: false,
    suppressClick: false,
  });
  const noteId = useId();
  const mealTextId = useId();
  const mealTextHelpId = useId();
  const tabsId = useId();
  const panelId = useId();

  // Each opening starts on the tab it was opened for.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setKind(mode === "medicine" ? "medicine" : "meal");
  }

  // A new video element (each time the dialog opens) shows the running stream at once.
  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    video.current = element;
    if (element && stream.current && element.srcObject !== stream.current) {
      element.srcObject = stream.current;
      void element.play().catch(() => undefined);
    }
  }, []);

  const full = shots.length >= MAX;
  const label = mode === "label";
  const medicineKind = !label && kind === "medicine";
  const tz = deviceTimeZone();
  const hasText = note.trim().length > 0;
  // A label photo needs the photo; a meal can also be words alone.
  const canSend = (shots.length > 0 || (!label && hasText)) && !busy;
  // The camera rests while the meal is typed and while a medicine photo is read or checked.
  const cameraOn = open && !textMode && !(medicineKind && medicine);
  // "Meal · Medicine" shows on the live camera (not over a package label or typed words).
  const showTabs = !label && !textMode && !medicine;

  // Start and stop the camera with the screen (and stop it while the meal is typed). Each way of
  // opening it must show a frame within FIRST_FRAME_MS; if none does, the screen offers the
  // phone's own camera instead.
  useEffect(() => {
    if (!cameraOn) return;
    let cancelled = false;
    const slowTimer = window.setTimeout(() => setSlow(true), SLOW_START_MS);
    const start = async () => {
      setState("starting");
      setSlow(false);
      if (!navigator.mediaDevices?.getUserMedia) {
        setState("unavailable");
        return;
      }
      await settleAfterStop();
      if (cancelled) return;
      // A busy camera (just released by the last stream) gets one more try after a pause.
      const requests = cameraRequests(facing);
      let busyRetries = 1;
      for (let i = 0; i < requests.length; i++) {
        const request = requests[i]!;
        let media: MediaStream;
        try {
          media = await navigator.mediaDevices.getUserMedia({ audio: false, video: request });
        } catch (error) {
          if (cancelled) return;
          const name = (error as DOMException)?.name;
          if (name === "NotAllowedError" || name === "SecurityError") return setState("denied");
          if (BUSY_ERRORS.has(name) && busyRetries > 0) {
            busyRetries -= 1;
            await wait(REOPEN_GAP_MS);
            if (cancelled) return;
            i -= 1;
          }
          continue;
        }
        if (cancelled) return stopStream(media);
        stopStream(stream.current);
        stream.current = media;
        // The video element mounts with the dialog; wait for it if the stream came first.
        if (!video.current) await nextFrame();
        if (cancelled) return;
        const element = video.current;
        if (element) {
          element.srcObject = media;
          void element.play().catch(() => undefined);
          const shown = await within(firstFrame(element), FIRST_FRAME_MS);
          if (cancelled) return;
          if (!shown) {
            stopStream(media);
            stream.current = null;
            element.srcObject = null;
            continue;
          }
        }
        setState("live");
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        if (!cancelled) setCanFlip(devices.filter((d) => d.kind === "videoinput").length > 1);
        return;
      }
      if (!cancelled) setState("unavailable");
    };
    void start();
    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
      stopStream(stream.current);
      stream.current = null;
    };
  }, [cameraOn, facing]);

  // Forget everything when the screen closes (Close, Escape or Send), the shutter flash too: a
  // flash left over from the last meal would cover the next meal's viewfinder.
  const reset = (revoke: boolean) => {
    setFlash(0);
    if (medicine?.url) URL.revokeObjectURL(medicine.url);
    setMedicine(null);
    dictation.current?.abort();
    dictation.current = null;
    if (revoke) for (const shot of shots) URL.revokeObjectURL(shot.url);
    setShots([]);
    setNote("");
    setTyping(false);
    setTextMode(false);
    setWhen(null);
    setWhenOpen(false);
    setListening(false);
    setHeard("");
    setAnnouncement("");
  };

  const close = () => {
    reset(true);
    onClose();
  };

  const addPhotos = useCallback(
    async (files: Blob[], takenAt: Date | null) => {
      const room = MAX - shots.length;
      if (room <= 0) return;
      setBusy(true);
      try {
        const added: Shot[] = [];
        for (const file of files.slice(0, room)) {
          const prepared = await preparePhoto(file);
          added.push({
            id: newId(),
            blob: prepared.blob,
            url: URL.createObjectURL(prepared.blob),
            width: prepared.width,
            height: prepared.height,
            capturedAt: prepared.capturedAt ?? takenAt ?? new Date(),
          });
        }
        const total = shots.length + added.length;
        setShots((current) => [...current, ...added].slice(0, MAX));
        setAnnouncement(
          total >= MAX
            ? `Photo ${total} of ${MAX} added. That is the most for one meal; press Send.`
            : `Photo ${total} added. Take another or press Send.`,
        );
        if (files.length > room) setAnnouncement(`Only ${MAX} photos fit in one meal.`);
      } catch (error) {
        setAnnouncement(error instanceof Error ? error.message : "That photo could not be used.");
      } finally {
        setBusy(false);
      }
    },
    [shots.length],
  );

  const takePhoto = async () => {
    if (!video.current || !stream.current || full || busy) return;
    const at = new Date();
    setFlash((n) => n + 1);
    try {
      const blob = await grabStill(video.current, stream.current);
      await addPhotos([blob], at);
    } catch {
      setAnnouncement("The photo could not be taken. Try again.");
    }
  };

  const removeShot = (id: string) => {
    setShots((current) => {
      const shot = current.find((s) => s.id === id);
      if (shot) URL.revokeObjectURL(shot.url);
      return current.filter((s) => s.id !== id);
    });
    setAnnouncement("Photo removed.");
  };

  // ---- Medicine: one photo of the box or blister, read by the person's AI provider ----

  const takeMedicinePhoto = async (file: Blob | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const prepared = await preparePhoto(file);
      setMedicine({
        key: Date.now(),
        blob: prepared.blob,
        url: URL.createObjectURL(prepared.blob),
      });
      setAnnouncement("Photo taken. Reading the label.");
    } catch (error) {
      setAnnouncement(error instanceof Error ? error.message : "That photo could not be used.");
    } finally {
      setBusy(false);
    }
  };

  const shootMedicine = async () => {
    if (!video.current || !stream.current || busy) return;
    setFlash((n) => n + 1);
    try {
      await takeMedicinePhoto(await grabStill(video.current, stream.current));
    } catch {
      setAnnouncement("The photo could not be taken. Try again.");
    }
  };

  /** Back to the live camera after the medicine sheet closed without saving. */
  const endMedicine = () => {
    if (medicine?.url) URL.revokeObjectURL(medicine.url);
    setMedicine(null);
  };

  // ---- Note: hold to talk, tap to type (and the microphone of the text mode) ----

  const startListening = () => {
    const session = startDictation({
      onText: (text) => setHeard(text),
      onEnd: (text) => {
        setListening(false);
        setHeard("");
        dictation.current = null;
        if (text)
          setNote((current) => `${current} ${text}`.trim().slice(0, UPLOAD_LIMITS.maxNoteChars));
      },
      onError: (reason) => {
        setListening(false);
        dictation.current = null;
        if (reason === "denied") {
          setAnnouncement("Microphone access was refused. Type the note instead.");
          setTyping(true);
        }
      },
    });
    if (!session) return false;
    dictation.current = session;
    setListening(true);
    setAnnouncement("Listening. Let go when you are done.");
    return true;
  };

  const onNotePointerDown = (event: React.PointerEvent) => {
    if (!speechSupported() || event.button !== 0) return;
    hold.current.suppressClick = false;
    hold.current.timer = window.setTimeout(() => {
      hold.current.timer = null;
      hold.current.active = startListening();
    }, HOLD_MS);
  };

  const onNotePointerEnd = () => {
    if (hold.current.timer !== null) {
      window.clearTimeout(hold.current.timer);
      hold.current.timer = null;
    }
    if (hold.current.active) {
      hold.current.active = false;
      hold.current.suppressClick = true;
      dictation.current?.stop();
      dictation.current = null;
    }
  };

  const onNoteClick = () => {
    if (hold.current.suppressClick) {
      hold.current.suppressClick = false;
      return;
    }
    setTyping(true);
  };

  /** The text mode's microphone: a tap starts dictation, another tap stops it. */
  const toggleDictation = () => {
    if (listening) {
      dictation.current?.stop();
      return;
    }
    if (startListening()) setAnnouncement("Listening. Tap the microphone again when you are done.");
  };

  const stopDictation = () => {
    dictation.current?.abort();
    dictation.current = null;
    setListening(false);
    setHeard("");
  };

  const switchKind = (next: CaptureKind) => {
    if (next === kind) return;
    stopDictation();
    setTyping(false);
    setKind(next);
    setAnnouncement(
      next === "medicine"
        ? "Medicine: photograph the box or blister, or type its name."
        : "Meal: take photos of your plate.",
    );
  };

  const switchToText = () => {
    stopDictation();
    setTyping(false);
    setTextMode(true);
    setAnnouncement("Type what you ate. The camera is off.");
  };

  const switchToPhoto = () => {
    stopDictation();
    setTextMode(false);
    setAnnouncement("");
  };

  useEffect(() => {
    if (typing) noteField.current?.focus();
  }, [typing]);

  useEffect(() => {
    if (open && textMode) mealText.current?.focus();
  }, [open, textMode]);

  // Keep focus on the next useful control: the shutter once the camera runs, the phone camera
  // button without one, and Send once three photos are taken. (Closing the When sheet gives
  // focus back to the When chip; this does not run then.) A tab chosen with the arrow keys keeps
  // the focus.
  useEffect(() => {
    if (!open || typing || textMode || medicine) return;
    if (document.activeElement?.getAttribute("role") === "tab") return;
    if (full && !medicineKind) sendButton.current?.focus();
    else if (state === "live") shutter.current?.focus();
    else if (state === "unavailable" || state === "denied") fallbackButton.current?.focus();
  }, [open, state, full, typing, textMode, medicine, medicineKind]);

  const send = () => {
    if (!canSend) return;
    // The provider keeps the photo data; the preview URLs are not needed any more.
    onSend(shots, note, when);
    reset(true);
  };

  const flipLabel = facing === "environment" ? "Use the front camera" : "Use the back camera";
  const now = new Date();
  const sendLabel = shots.length
    ? `Send meal with ${shots.length} ${shots.length === 1 ? "photo" : "photos"}`
    : hasText && !label
      ? "Send the meal (text only)"
      : label
        ? "Send (take a photo first)"
        : "Send meal (take a photo or type what you ate first)";

  // Text mode uses the app's own colours; the camera stays dark around the live picture.
  const round = textMode ? "bg-surface-2 text-text" : "bg-black/50 text-white backdrop-blur-sm";
  const side = textMode ? "bg-surface-2 text-text hover:bg-surface-3" : "bg-white/15 text-white";

  const thumbnails = (
    <ul aria-label="Photos of this meal" className="flex items-center gap-2">
      {shots.map((shot, i) => (
        <li key={shot.id}>
          <button
            type="button"
            onClick={() => removeShot(shot.id)}
            aria-label={`Remove photo ${i + 1}`}
            className="group relative block size-15 overflow-hidden rounded-xl ring-2 ring-white/85"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
            <img src={shot.url} alt="" className="size-full object-cover" />
            <span className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-black/70 text-white">
              <X aria-hidden className="size-3.5" />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "data-[state=open]:animate-fade-in fixed inset-0 z-50 flex flex-col outline-none",
            textMode ? "bg-bg text-text" : "bg-black text-white",
          )}
          data-testid="camera"
          data-camera-state={cameraOn ? state : "off"}
          data-mode={textMode ? "text" : medicineKind ? "medicine" : "photo"}
        >
          <Dialog.Title className="sr-only">
            {label ? "Photograph a label or package" : "Camera"}
          </Dialog.Title>

          {!textMode && (
            <video
              ref={attachVideo}
              playsInline
              muted
              autoPlay
              aria-hidden
              className={cn(
                "absolute inset-0 size-full object-cover",
                facing === "user" && "-scale-x-100",
                state !== "live" && "invisible",
              )}
            />
          )}
          {flash > 0 && !textMode && (
            // Shown once per shutter press and removed when it has faded: left on screen, the
            // white sheet would hide the camera.
            <div
              key={flash}
              aria-hidden
              data-testid="shutter-flash"
              onAnimationEnd={() => setFlash(0)}
              className="animate-fade-out pointer-events-none absolute inset-0 bg-white motion-reduce:hidden"
            />
          )}

          {medicine?.url && (
            // The label photo stays on screen while it is read and checked (its top shows above
            // the sheet).
            // eslint-disable-next-line @next/next/no-img-element -- local preview
            <img
              src={medicine.url}
              alt=""
              className="absolute inset-0 size-full bg-black object-cover object-top"
            />
          )}

          {/* Top bar: close, when, flip */}
          <div className="relative flex items-center justify-between gap-2 px-3 pt-[max(env(safe-area-inset-top),0.875rem)]">
            <Dialog.Close
              aria-label="Close the camera"
              className={cn("grid size-12 shrink-0 place-items-center rounded-full", round)}
            >
              <X aria-hidden className="size-6" />
            </Dialog.Close>
            {label ? (
              <p className="text-label rounded-full bg-black/50 px-3 py-1.5 backdrop-blur-sm">
                Label or package
              </p>
            ) : medicineKind ? (
              <p className="text-label inline-flex min-h-11 items-center gap-1.5 rounded-full bg-black/50 px-3.5 backdrop-blur-sm">
                <Pill aria-hidden className="size-4" /> Medicine label
              </p>
            ) : (
              <button
                ref={whenChip}
                type="button"
                onClick={() => setWhenOpen(true)}
                aria-label={`When: ${whenSpoken(when, now, tz)}. Change the time`}
                aria-haspopup="dialog"
                data-testid="when-chip"
                className={cn(
                  "text-label inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded-full px-3.5",
                  when ? "bg-primary-soft text-on-primary-soft" : round,
                )}
              >
                <Clock aria-hidden className="size-4 shrink-0" />
                <span className="truncate">{whenLabel(when, now, tz)}</span>
                <ChevronDown aria-hidden className="size-3.5 shrink-0" />
              </button>
            )}
            {canFlip && state === "live" && cameraOn ? (
              <button
                type="button"
                aria-label={flipLabel}
                title={flipLabel}
                onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
                className={cn("grid size-12 shrink-0 place-items-center rounded-full", round)}
              >
                <RefreshCcw aria-hidden className="size-5" />
              </button>
            ) : (
              <span aria-hidden className="size-12 shrink-0" />
            )}
          </div>

          {textMode ? (
            // Middle, text mode: what was eaten, in words.
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-7">
              <label htmlFor={mealTextId} className="text-title">
                What did you eat?
              </label>
              <div className="border-border bg-surface flex flex-col gap-2.5 rounded-[1.25rem] border p-3.5">
                <textarea
                  ref={mealText}
                  id={mealTextId}
                  dir="auto"
                  rows={5}
                  maxLength={UPLOAD_LIMITS.maxNoteChars}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  aria-describedby={mealTextHelpId}
                  className="w-full resize-none bg-transparent text-lg leading-[1.45] focus:outline-none"
                />
                {(heard || listening) && (
                  <p className="text-caption text-muted" dir="auto" aria-hidden>
                    {heard || "Listening…"}
                  </p>
                )}
                <div className="flex items-center justify-between gap-3">
                  <p id={mealTextHelpId} className="text-caption text-muted">
                    Name each food and about how much. Cal works out the rest.
                  </p>
                  {speechSupported() && (
                    <button
                      type="button"
                      onClick={toggleDictation}
                      aria-label={listening ? "Stop dictating" : "Dictate instead"}
                      aria-pressed={listening}
                      className={cn(
                        "grid size-12 shrink-0 place-items-center rounded-full transition-colors",
                        listening
                          ? "animate-pulse-soft bg-danger text-on-danger"
                          : "bg-surface-2 hover:bg-surface-3",
                      )}
                    >
                      <Mic aria-hidden className="size-5.5" />
                    </button>
                  )}
                </div>
              </div>
              {shots.length > 0 && (
                <div className="flex items-center gap-3">
                  {thumbnails}
                  <p className="text-caption text-muted">
                    {shots.length} of {MAX} photos
                  </p>
                </div>
              )}
            </div>
          ) : (
            // Middle, photo mode: the viewfinder, or what to do without one.
            <div
              className="relative flex flex-1 items-center justify-center px-6"
              {...(showTabs
                ? { role: "tabpanel", id: panelId, "aria-labelledby": captureTabId(tabsId, kind) }
                : {})}
            >
              {state === "starting" && cameraOn && (
                <div className="max-w-xs text-center">
                  <p className="text-body text-white/80" role="status">
                    Starting the camera…
                  </p>
                  {slow && (
                    <button
                      type="button"
                      disabled={full || busy}
                      onClick={() => systemCamera.current?.click()}
                      className="text-label mt-5 inline-flex min-h-12 items-center gap-2 rounded-full bg-white px-5 text-black disabled:opacity-50"
                    >
                      <Camera aria-hidden className="size-5" /> Use the phone&apos;s camera
                    </button>
                  )}
                </div>
              )}
              {(state === "unavailable" || state === "denied") && !medicine && (
                <div className="max-w-xs text-center">
                  <Camera aria-hidden className="mx-auto size-10 text-white/70" />
                  <p className="text-headline mt-3">
                    {state === "denied" ? "Cal may not use the camera" : "The camera did not start"}
                  </p>
                  <p className="text-body mt-1 text-white/75">
                    {state === "denied"
                      ? "Allow camera access in the browser settings, or take the photo with your phone's camera."
                      : "Take the photo with your phone's camera, or pick one from the gallery."}
                  </p>
                  <button
                    ref={fallbackButton}
                    type="button"
                    disabled={full || busy}
                    onClick={() => systemCamera.current?.click()}
                    className="text-label mt-5 inline-flex min-h-12 items-center gap-2 rounded-full bg-white px-5 text-black disabled:opacity-50"
                  >
                    <Camera aria-hidden className="size-5" /> Take a photo
                  </button>
                </div>
              )}
              {(label || medicineKind) && state === "live" && cameraOn && (
                <div
                  aria-hidden
                  className="pointer-events-none aspect-[3/4] w-[78%] max-w-sm rounded-3xl border-2 border-white/70"
                />
              )}
            </div>
          )}

          {/* Bottom: thumbnails and note (meal photos), the tabs, then the controls. Hidden while a
              medicine photo is read and checked (MedicineCapture takes the place). */}
          {!medicine && (
            <div
              className={cn(
                "relative flex flex-col gap-3.5 px-4 pt-3.5 pb-[max(env(safe-area-inset-bottom),1.375rem)]",
                !textMode && "bg-black/72",
              )}
            >
              {!textMode && !medicineKind && typing && (
                <div className="rounded-2xl bg-white/12 p-2 backdrop-blur-md">
                  <label htmlFor={noteId} className="sr-only">
                    Note about the meal
                  </label>
                  <textarea
                    ref={noteField}
                    id={noteId}
                    dir="auto"
                    rows={2}
                    maxLength={UPLOAD_LIMITS.maxNoteChars}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="For example: ate half, fried in olive oil"
                    className="text-body w-full resize-none rounded-xl bg-transparent px-2 py-1 text-white placeholder:text-white/55 focus:outline-none"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setTyping(false)}
                      className="text-label inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white px-4 text-black"
                    >
                      <Check aria-hidden className="size-4" /> Done
                    </button>
                  </div>
                </div>
              )}

              {!textMode && !medicineKind && (
                <div className="flex items-center gap-2.5">
                  {thumbnails}
                  <p className="text-caption min-w-0 flex-1 text-white/80">
                    {shots.length} of {MAX} photos
                  </p>
                  <button
                    type="button"
                    aria-label={
                      speechSupported() ? "Note: hold to talk, tap to type" : "Note: tap to type"
                    }
                    aria-pressed={listening || undefined}
                    onPointerDown={onNotePointerDown}
                    onPointerUp={onNotePointerEnd}
                    onPointerCancel={onNotePointerEnd}
                    onPointerLeave={onNotePointerEnd}
                    onContextMenu={(event) => event.preventDefault()}
                    onClick={onNoteClick}
                    className={cn(
                      "grid size-13 shrink-0 touch-none place-items-center rounded-full bg-white/15 transition-colors select-none [-webkit-touch-callout:none]",
                      listening && "animate-pulse-soft bg-red-600",
                    )}
                  >
                    <Mic aria-hidden className="size-5.5" />
                  </button>
                </div>
              )}

              {!textMode && !medicineKind && (note || heard) && !typing && (
                <p
                  dir="auto"
                  className="text-body -mt-1.5 line-clamp-2 text-white/90"
                  data-testid="capture-note"
                >
                  {heard || note}
                </p>
              )}
              {!textMode && !medicineKind && listening && !heard && (
                <p className="text-caption -mt-1.5 text-white/75">
                  Listening… let go when you are done.
                </p>
              )}
              {medicineKind && (
                <p className="text-caption text-center text-white/80">
                  Photograph the box or blister so the name and strength show.
                </p>
              )}

              {showTabs && (
                <CaptureTabs
                  value={kind}
                  onChange={switchKind}
                  idBase={tabsId}
                  panelId={panelId}
                  disabled={busy}
                />
              )}

              <div className="grid grid-cols-3 items-center">
                <div className="flex justify-start gap-2.5">
                  {textMode && (
                    <button type="button" onClick={switchToPhoto} className={cn(sideButton, side)}>
                      <Camera aria-hidden className="size-5.5" />
                      Photo
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => gallery.current?.click()}
                    disabled={(full && !medicineKind) || busy}
                    aria-label={
                      medicineKind ? "Gallery: pick a photo of the label" : "Gallery: pick photos"
                    }
                    className={cn(sideButton, side)}
                  >
                    <ImageIcon aria-hidden className="size-5.5" />
                    Gallery
                  </button>
                  {!textMode && !label && (
                    <button
                      type="button"
                      onClick={() =>
                        medicineKind
                          ? setMedicine({ key: Date.now(), blob: null, url: null })
                          : switchToText()
                      }
                      aria-label={
                        medicineKind
                          ? "Type: write the name of the medicine"
                          : "Type: describe the meal in words"
                      }
                      className={cn(sideButton, side)}
                    >
                      <CaseSensitive aria-hidden className="size-5.5" />
                      Type
                    </button>
                  )}
                </div>
                <div className="flex justify-center">
                  {!textMode && (
                    <button
                      ref={shutter}
                      type="button"
                      onClick={() => void (medicineKind ? shootMedicine() : takePhoto())}
                      disabled={state !== "live" || (full && !medicineKind) || busy}
                      aria-label={
                        medicineKind
                          ? "Photograph the label"
                          : full
                            ? "Three photos taken, the most for one meal"
                            : "Take photo"
                      }
                      className="grid size-20 place-items-center rounded-full border-4 border-white transition-transform active:scale-95 disabled:opacity-40"
                    >
                      <span className="block size-16 rounded-full bg-white" />
                    </button>
                  )}
                </div>
                <div className="flex justify-end">
                  {!medicineKind && (
                    <button
                      ref={sendButton}
                      type="button"
                      onClick={send}
                      disabled={!canSend}
                      aria-label={sendLabel}
                      className={cn(
                        "bg-primary text-on-primary inline-flex min-h-14 items-center gap-2 rounded-full px-5 text-[0.9375rem] font-semibold shadow-lg",
                        textMode
                          ? "disabled:bg-surface-2 disabled:text-muted disabled:shadow-none"
                          : "disabled:bg-white/15 disabled:text-white/60",
                      )}
                    >
                      Send <ArrowRight aria-hidden className="size-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {medicineKind && medicine && (
            <MedicineCapture
              key={medicine.key}
              photo={medicine.blob}
              online={online}
              onCancel={endMedicine}
              onSaved={(logged) => {
                onMedicineSaved(logged);
                reset(true);
              }}
            />
          )}

          <p aria-live="polite" className="sr-only" data-testid="camera-status">
            {announcement}
          </p>

          <input
            ref={systemCamera}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            data-testid="capture-input"
            aria-label="Take a photo with the phone camera"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (medicineKind) void takeMedicinePhoto(files[0]);
              else void addPhotos(files, new Date());
            }}
          />
          <input
            ref={gallery}
            type="file"
            accept="image/*"
            multiple={!medicineKind}
            hidden
            data-testid="gallery-input"
            aria-label="Photos from the gallery"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (medicineKind) void takeMedicinePhoto(files[0]);
              else void addPhotos(files, null);
            }}
          />

          {!label && (
            <WhenSheet
              open={whenOpen}
              onOpenChange={setWhenOpen}
              value={when}
              tz={tz}
              elevated
              returnFocus={whenChip}
              description="Photos from the gallery keep the time they were taken."
              onDone={(at) => {
                setWhen(at);
                setWhenOpen(false);
                setAnnouncement(`When: ${whenSpoken(at, new Date(), tz)}.`);
              }}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
