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
  Timer,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { PoseGuide } from "@/components/body/pose-guide";
import { MedicineCapture } from "@/components/medicines/medicine-capture";
import { cn } from "@/components/ui/cn";
import { api } from "@/lib/client/api";
import { startDictation, speechSupported, type Dictation } from "@/lib/client/speech";
import {
  BODY_PHOTO_NOTICE,
  BODY_POSES,
  POSE_GUIDES,
  POSE_LABELS,
  SELF_TIMERS,
  type BodyPose,
} from "@/lib/contracts/body-photos";
import { UPLOAD_LIMITS } from "@/lib/contracts/meals";
import type { LoggedMedicine } from "@/lib/contracts/medicines";
import { deviceTimeZone, preparePhoto, readCaptureTime } from "@/lib/photos/client";
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
/** How long an opened camera may take to show its first frame before Kal tries the next way. */
const FIRST_FRAME_MS = 5000;
/** How long a full sensor photo may take before Kal uses the video frame instead. */
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

/** How the body photos went, for the toast after the camera closes. */
export type BodyCaptureResult = { saved: number; failed: number; skipped: number; closed: boolean };

/** Kept as taken: the server re-encodes at full size (a later 3D step needs the detail). */
const FULL_SIZE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** A body photo for upload: the file itself, or a full-size JPEG for other types (HEIC). */
const bodyPhotoBlob = async (file: Blob) =>
  FULL_SIZE_TYPES.has(file.type)
    ? file
    : (await preparePhoto(file, { longEdge: 8192, quality: 0.92 })).blob;

type BodyMark = "saving" | "saved" | "failed" | "skipped";

const kindOf = (mode: "meal" | "label" | "medicine" | "body"): CaptureKind =>
  mode === "medicine" || mode === "body" ? mode : "meal";

const sideButton =
  "flex min-h-16 w-[3.375rem] flex-col items-center justify-center gap-1 rounded-2xl text-[0.6875rem] leading-none font-semibold disabled:opacity-40";

/**
 * The full-screen in-app camera (docs/DESIGN.md section 3): shutter, up to three thumbnails (tap
 * to remove), gallery, hold-to-talk note with tap-to-type, the meal's time (the When chip), Send
 * and close. "Type" switches to a meal described in words: the camera stops and a large text
 * field takes its place; Send then works with words alone. Without camera access it offers the
 * phone's own camera through a file input instead.
 *
 * Above the shutter, "Meal · Medicine · Body" (capture-tabs.tsx) switches what is captured.
 * Medicine takes one photo of a box or blister (or one from the gallery); the person's AI provider
 * reads it and the medicine sheet opens to check and save it ("Type" opens the sheet empty).
 * Body (board 8) guides four photos, Front, Left, Back and Right, with a pose outline and a
 * self-timer (off, 3 or 10 s); each is uploaded at full size as soon as it is taken (never to an
 * AI), and Skip moves on.
 */
export const CameraScreen = ({
  open,
  mode,
  onClose,
  onSend,
  onMedicineSaved,
  onBodyDone,
}: {
  open: boolean;
  /**
   * label: a package photo for the Add screen (no tabs); medicine and body open on their tabs.
   */
  mode: "meal" | "label" | "medicine" | "body";
  onClose: () => void;
  /** at: the time chosen with the When chip, null for the photo's own time (or now). */
  onSend: (shots: Shot[], note: string, at: Date | null) => void;
  onMedicineSaved: (logged: LoggedMedicine) => void;
  /** The body photos are done (all four poses, or the camera was closed after some). */
  onBodyDone: (result: BodyCaptureResult) => void;
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
  const [kind, setKind] = useState<CaptureKind>(kindOf(mode));
  // Body photos: the pose to take, how each went, the self-timer and its countdown.
  const [bodyStep, setBodyStep] = useState(0);
  const [bodyMarks, setBodyMarks] = useState<Partial<Record<BodyPose, BodyMark>>>({});
  const [selfTimer, setSelfTimer] = useState<(typeof SELF_TIMERS)[number]>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [finishing, setFinishing] = useState(false);
  const countdownTimer = useRef<number | null>(null);
  const bodyUploads = useRef<Promise<boolean>[]>([]);
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
    if (open) setKind(kindOf(mode));
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
  const bodyKind = !label && kind === "body";
  const mealKind = !medicineKind && !bodyKind;
  const pose: BodyPose = BODY_POSES[Math.min(bodyStep, BODY_POSES.length - 1)]!;
  const tz = deviceTimeZone();
  const hasText = note.trim().length > 0;
  // A label photo needs the photo; a meal can also be words alone.
  const canSend = (shots.length > 0 || (!label && hasText)) && !busy;
  // The camera rests while the meal is typed and while a medicine photo is read or checked.
  const cameraOn = open && !textMode && !(medicineKind && medicine);
  // "Meal · Medicine · Body" shows on the live camera (not over a package label or typed words).
  const showTabs = !label && !textMode && !medicine;

  // ---- Body: four guided photos, each uploaded at full size as soon as it is taken ----

  const stopCountdown = () => {
    if (countdownTimer.current !== null) window.clearTimeout(countdownTimer.current);
    countdownTimer.current = null;
    setCountdown(null);
  };

  /** Waits for the uploads still running and says how it went (once per set of photos). */
  const settleBody = async (closed: boolean) => {
    const uploads = bodyUploads.current;
    bodyUploads.current = [];
    if (!uploads.length) return;
    const results = await Promise.all(uploads);
    const saved = results.filter(Boolean).length;
    onBodyDone({
      saved,
      failed: results.length - saved,
      skipped: closed ? 0 : BODY_POSES.length - results.length,
      closed,
    });
  };

  const nextPose = async (said: string) => {
    const next = bodyStep + 1;
    if (next < BODY_POSES.length) {
      setBodyStep(next);
      const nextPoseName = BODY_POSES[next]!;
      setAnnouncement(`${said} Next: ${POSE_LABELS[nextPoseName]}. ${POSE_GUIDES[nextPoseName]}`);
      return;
    }
    if (!bodyUploads.current.length) {
      setAnnouncement(`${said} No photos were taken.`);
      close();
      return;
    }
    setFinishing(true);
    setAnnouncement(`${said} Saving the photos.`);
    await settleBody(false);
    setFinishing(false);
    reset(true);
  };

  const saveBodyPhoto = (blob: Blob, takenAt: Date, source: "camera" | "gallery") => {
    const taken = pose;
    setBodyMarks((marks) => ({ ...marks, [taken]: "saving" }));
    bodyUploads.current.push(
      api
        .uploadBodyPhoto(blob, {
          pose: taken,
          takenAt: takenAt.toISOString(),
          tz,
          facing: source === "camera" ? facing : null,
          source,
        })
        .then(() => {
          setBodyMarks((marks) => ({ ...marks, [taken]: "saved" }));
          return true;
        })
        .catch(() => {
          setBodyMarks((marks) => ({ ...marks, [taken]: "failed" }));
          return false;
        }),
    );
    void nextPose(`${POSE_LABELS[taken]} photo taken.`);
  };

  const captureBody = async () => {
    if (!video.current || !stream.current) return;
    const at = new Date();
    setFlash((n) => n + 1);
    try {
      saveBodyPhoto(await grabStill(video.current, stream.current), at, "camera");
    } catch {
      setAnnouncement("The photo could not be taken. Try again.");
    }
  };

  /** The shutter: at once, or after the self-timer's countdown (spoken each second). */
  const shootBody = () => {
    if (!video.current || !stream.current || busy || countdown !== null || finishing) return;
    if (!selfTimer) return void captureBody();
    let left: number = selfTimer;
    setCountdown(left);
    setAnnouncement(`${left} seconds.`);
    const tick = () => {
      left -= 1;
      if (left <= 0) {
        countdownTimer.current = null;
        setCountdown(null);
        void captureBody();
        return;
      }
      setCountdown(left);
      setAnnouncement(String(left));
      countdownTimer.current = window.setTimeout(tick, 1000);
    };
    countdownTimer.current = window.setTimeout(tick, 1000);
  };

  /** A photo from the gallery (or the phone's own camera) for the current pose. */
  const bodyFromFile = async (file: File | undefined, source: "camera" | "gallery") => {
    if (!file) return;
    setBusy(true);
    try {
      const takenAt = (source === "gallery" ? await readCaptureTime(file) : null) ?? new Date();
      saveBodyPhoto(await bodyPhotoBlob(file), takenAt, source);
    } catch (error) {
      setAnnouncement(error instanceof Error ? error.message : "That photo could not be used.");
    } finally {
      setBusy(false);
    }
  };

  const skipPose = () => {
    stopCountdown();
    setBodyMarks((marks) => ({ ...marks, [pose]: "skipped" }));
    void nextPose(`${POSE_LABELS[pose]} skipped.`);
  };

  const nextTimer = () => {
    const next = SELF_TIMERS[(SELF_TIMERS.indexOf(selfTimer) + 1) % SELF_TIMERS.length]!;
    setSelfTimer(next);
    setAnnouncement(next ? `Self-timer: ${next} seconds.` : "Self-timer off.");
  };

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
    stopCountdown();
    setBodyStep(0);
    setBodyMarks({});
    setFinishing(false);
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
    // Body photos already taken are saved; their toast comes once the uploads are done.
    void settleBody(true);
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
    stopCountdown();
    setTyping(false);
    setKind(next);
    setAnnouncement(
      next === "medicine"
        ? "Medicine: photograph the box or blister, or type its name."
        : next === "body"
          ? `Body: four photos. ${POSE_LABELS[pose]}: ${POSE_GUIDES[pose]}`
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
    if (full && mealKind) sendButton.current?.focus();
    else if (state === "live") shutter.current?.focus();
    else if (state === "unavailable" || state === "denied") fallbackButton.current?.focus();
  }, [open, state, full, typing, textMode, medicine, mealKind]);

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
          data-mode={textMode ? "text" : medicineKind ? "medicine" : bodyKind ? "body" : "photo"}
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
            ) : bodyKind ? (
              <p
                className="text-label inline-flex min-h-11 items-center rounded-full bg-black/50 px-3.5 backdrop-blur-sm"
                data-testid="body-pose"
              >
                {POSE_LABELS[pose]} · {bodyStep + 1} of {BODY_POSES.length}
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
            <div className="flex shrink-0 items-center gap-1.5">
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
                !bodyKind && <span aria-hidden className="size-12 shrink-0" />
              )}
              {bodyKind && (
                <button
                  type="button"
                  onClick={nextTimer}
                  disabled={countdown !== null}
                  aria-label={
                    selfTimer
                      ? `Self-timer: ${selfTimer} seconds. Change it`
                      : "Self-timer: off. Change it"
                  }
                  className={cn(
                    "inline-flex min-h-12 items-center gap-1.5 rounded-full px-3 text-sm font-semibold",
                    round,
                  )}
                >
                  <Timer aria-hidden className="size-4.5" />
                  {selfTimer ? `${selfTimer} s` : "Off"}
                </button>
              )}
            </div>
          </div>

          {bodyKind && !textMode && (
            <p className="relative mx-6 mt-3 rounded-[0.875rem] bg-black/55 px-3 py-2.5 text-center text-[0.8125rem] leading-snug">
              {POSE_GUIDES[pose]}
            </p>
          )}

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
                    Name each food and about how much. Kal works out the rest.
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
                    {state === "denied" ? "Kal may not use the camera" : "The camera did not start"}
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
              {bodyKind && state === "live" && cameraOn && <PoseGuide pose={pose} />}
              {bodyKind && countdown !== null && (
                <p
                  aria-hidden
                  className="absolute inset-0 grid place-items-center text-[7rem] leading-none font-bold drop-shadow-lg"
                  data-testid="body-countdown"
                >
                  {countdown}
                </p>
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
              {!textMode && mealKind && typing && (
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

              {!textMode && mealKind && (
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

              {!textMode && mealKind && (note || heard) && !typing && (
                <p
                  dir="auto"
                  className="text-body -mt-1.5 line-clamp-2 text-white/90"
                  data-testid="capture-note"
                >
                  {heard || note}
                </p>
              )}
              {!textMode && mealKind && listening && !heard && (
                <p className="text-caption -mt-1.5 text-white/75">
                  Listening… let go when you are done.
                </p>
              )}
              {medicineKind && (
                <p className="text-caption text-center text-white/80">
                  Photograph the box or blister so the name and strength show.
                </p>
              )}
              {bodyKind && !textMode && (
                <ol
                  aria-label="Poses"
                  className="grid grid-cols-4 gap-1.5"
                  data-testid="body-poses"
                >
                  {BODY_POSES.map((p, i) => {
                    const mark = bodyMarks[p];
                    const current = i === bodyStep;
                    return (
                      <li
                        key={p}
                        aria-current={current ? "step" : undefined}
                        className={cn(
                          "flex min-h-9 items-center justify-center gap-1 rounded-full text-[0.8125rem]",
                          current ? "bg-white font-bold text-black" : "bg-white/15 font-semibold",
                        )}
                      >
                        {(mark === "saved" || mark === "saving") && (
                          <Check aria-hidden className="size-3.5" />
                        )}
                        {POSE_LABELS[p]}
                        <span className="sr-only">
                          {mark === "saved"
                            ? ", saved"
                            : mark === "saving"
                              ? ", saving"
                              : mark === "failed"
                                ? ", not saved"
                                : mark === "skipped"
                                  ? ", skipped"
                                  : ""}
                        </span>
                      </li>
                    );
                  })}
                </ol>
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
                    disabled={(full && mealKind) || busy || finishing || (bodyKind && !online)}
                    aria-label={
                      medicineKind
                        ? "Gallery: pick a photo of the label"
                        : bodyKind
                          ? `Gallery: pick the ${POSE_LABELS[pose].toLowerCase()} photo`
                          : "Gallery: pick photos"
                    }
                    className={cn(sideButton, side)}
                  >
                    <ImageIcon aria-hidden className="size-5.5" />
                    Gallery
                  </button>
                  {!textMode && !label && !bodyKind && (
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
                      onClick={() =>
                        void (medicineKind ? shootMedicine() : bodyKind ? shootBody() : takePhoto())
                      }
                      disabled={
                        state !== "live" ||
                        (full && mealKind) ||
                        busy ||
                        (bodyKind && (!online || finishing || countdown !== null))
                      }
                      aria-label={
                        medicineKind
                          ? "Photograph the label"
                          : bodyKind
                            ? `Take the ${POSE_LABELS[pose].toLowerCase()} photo`
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
                  {bodyKind && !textMode && (
                    <button
                      type="button"
                      onClick={skipPose}
                      disabled={finishing}
                      aria-label={`Skip the ${POSE_LABELS[pose].toLowerCase()} photo`}
                      className="min-h-12 rounded-full bg-white/15 px-4 text-sm font-semibold disabled:opacity-40"
                    >
                      Skip
                    </button>
                  )}
                  {mealKind && (
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
              {bodyKind && !textMode && (
                <p className="text-caption text-center text-white/80">
                  {finishing
                    ? "Saving the photos…"
                    : !online
                      ? "Body photos need a connection; they are saved as soon as they are taken."
                      : BODY_PHOTO_NOTICE}
                </p>
              )}
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
              else if (bodyKind) void bodyFromFile(files[0], "camera");
              else void addPhotos(files, new Date());
            }}
          />
          <input
            ref={gallery}
            type="file"
            accept="image/*"
            multiple={mealKind}
            hidden
            data-testid="gallery-input"
            aria-label="Photos from the gallery"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (medicineKind) void takeMedicinePhoto(files[0]);
              else if (bodyKind) void bodyFromFile(files[0], "gallery");
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
