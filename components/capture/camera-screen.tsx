"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Camera, Check, Images, Mic, RefreshCcw, Send, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { cn } from "@/components/ui/cn";
import { startDictation, speechSupported, type Dictation } from "@/lib/client/speech";
import { UPLOAD_LIMITS } from "@/lib/contracts/meals";
import { preparePhoto } from "@/lib/photos/client";

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

type ImageCaptureLike = { takePhoto: () => Promise<Blob> };
type ImageCaptureConstructor = new (track: MediaStreamTrack) => ImageCaptureLike;

const stopStream = (stream: MediaStream | null) => stream?.getTracks().forEach((t) => t.stop());

/** One still from the live camera: the full sensor photo where the browser offers it. */
const grabStill = async (video: HTMLVideoElement, stream: MediaStream): Promise<Blob> => {
  const track = stream.getVideoTracks()[0];
  const Ctor = (globalThis as unknown as { ImageCapture?: ImageCaptureConstructor }).ImageCapture;
  if (track && Ctor) {
    try {
      const blob = await new Ctor(track).takePhoto();
      if (blob.size > 0) return blob;
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

/**
 * The full-screen in-app camera (docs/DESIGN.md section 3): shutter, up to three thumbnails (tap
 * to remove), gallery, hold-to-talk note with tap-to-type, Send and close. Without camera access
 * it offers the phone's own camera through a file input instead.
 */
export const CameraScreen = ({
  open,
  mode,
  onClose,
  onSend,
}: {
  open: boolean;
  mode: "meal" | "label";
  onClose: () => void;
  onSend: (shots: Shot[], note: string) => void;
}) => {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const shutter = useRef<HTMLButtonElement>(null);
  const fallbackButton = useRef<HTMLButtonElement>(null);
  const sendButton = useRef<HTMLButtonElement>(null);
  const systemCamera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const noteField = useRef<HTMLTextAreaElement>(null);
  const [state, setState] = useState<CameraState>("starting");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [canFlip, setCanFlip] = useState(false);
  const [shots, setShots] = useState<Shot[]>([]);
  const [note, setNote] = useState("");
  const [typing, setTyping] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const dictation = useRef<Dictation | null>(null);
  const hold = useRef<{ timer: number | null; active: boolean; suppressClick: boolean }>({
    timer: null,
    active: false,
    suppressClick: false,
  });
  const noteId = useId();

  const full = shots.length >= MAX;
  const label = mode === "label";

  // Start and stop the camera with the screen.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const start = async () => {
      setState("starting");
      if (!navigator.mediaDevices?.getUserMedia) {
        setState("unavailable");
        return;
      }
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 4096 },
            height: { ideal: 3072 },
          },
        });
        if (cancelled) return stopStream(media);
        stopStream(stream.current);
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play().catch(() => undefined);
        }
        setState("live");
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        if (!cancelled) setCanFlip(devices.filter((d) => d.kind === "videoinput").length > 1);
      } catch (error) {
        if (cancelled) return;
        const name = (error as DOMException)?.name;
        setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
      }
    };
    void start();
    return () => {
      cancelled = true;
      stopStream(stream.current);
      stream.current = null;
    };
  }, [open, facing]);

  // Forget everything when the screen closes (Close, Escape or Send).
  const reset = (revoke: boolean) => {
    dictation.current?.abort();
    dictation.current = null;
    if (revoke) for (const shot of shots) URL.revokeObjectURL(shot.url);
    setShots([]);
    setNote("");
    setTyping(false);
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

  // ---- Note: hold to talk, tap to type ----

  const startListening = () => {
    const session = startDictation({
      onText: (text) => setHeard(text),
      onEnd: (text) => {
        setListening(false);
        setHeard("");
        if (text)
          setNote((current) => `${current} ${text}`.trim().slice(0, UPLOAD_LIMITS.maxNoteChars));
      },
      onError: (reason) => {
        setListening(false);
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

  useEffect(() => {
    if (typing) noteField.current?.focus();
  }, [typing]);

  // Keep focus on the next useful control: the shutter once the camera runs, the phone camera
  // button without one, and Send once three photos are taken.
  useEffect(() => {
    if (!open || typing) return;
    if (full) sendButton.current?.focus();
    else if (state === "live") shutter.current?.focus();
    else if (state === "unavailable" || state === "denied") fallbackButton.current?.focus();
  }, [open, state, full, typing]);

  const send = () => {
    if (!shots.length) return;
    // The provider keeps the photo data; the preview URLs are not needed any more.
    onSend(shots, note);
    reset(true);
  };

  const flipLabel = facing === "environment" ? "Use the front camera" : "Use the back camera";

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          className="data-[state=open]:animate-fade-in fixed inset-0 z-50 flex flex-col bg-black text-white outline-none"
          data-testid="camera"
          data-camera-state={state}
        >
          <Dialog.Title className="sr-only">
            {label ? "Photograph a label or package" : "Camera"}
          </Dialog.Title>

          <video
            ref={video}
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
          {flash > 0 && (
            <div
              key={flash}
              aria-hidden
              className="animate-fade-out pointer-events-none absolute inset-0 bg-white motion-reduce:hidden"
            />
          )}

          {/* Top bar */}
          <div className="relative flex items-center justify-between px-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
            <Dialog.Close
              aria-label="Close the camera"
              className="grid size-12 place-items-center rounded-full bg-black/45 backdrop-blur-sm"
            >
              <X aria-hidden className="size-6" />
            </Dialog.Close>
            <p className="text-label rounded-full bg-black/45 px-3 py-1.5 backdrop-blur-sm">
              {label ? "Label or package" : `${shots.length} of ${MAX} photos`}
            </p>
            {canFlip && state === "live" ? (
              <button
                type="button"
                aria-label={flipLabel}
                title={flipLabel}
                onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
                className="grid size-12 place-items-center rounded-full bg-black/45 backdrop-blur-sm"
              >
                <RefreshCcw aria-hidden className="size-5" />
              </button>
            ) : (
              <span aria-hidden className="size-12" />
            )}
          </div>

          {/* Middle: the viewfinder, or what to do without one */}
          <div className="relative flex flex-1 items-center justify-center px-6">
            {state === "starting" && (
              <p className="text-body text-white/80" role="status">
                Starting the camera…
              </p>
            )}
            {(state === "unavailable" || state === "denied") && (
              <div className="max-w-xs text-center">
                <Camera aria-hidden className="mx-auto size-10 text-white/70" />
                <p className="text-headline mt-3">
                  {state === "denied" ? "Cal may not use the camera" : "No camera here"}
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
            {label && state === "live" && (
              <div
                aria-hidden
                className="pointer-events-none aspect-[3/4] w-[78%] max-w-sm rounded-3xl border-2 border-white/70"
              />
            )}
          </div>

          {/* Bottom: thumbnails, note, controls */}
          <div className="relative bg-gradient-to-t from-black/85 via-black/60 to-transparent px-4 pt-6 pb-[max(env(safe-area-inset-bottom),1rem)]">
            {typing && (
              <div className="mb-3 rounded-2xl bg-white/12 p-2 backdrop-blur-md">
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

            <div className="flex items-end gap-2">
              <ul aria-label="Photos of this meal" className="flex min-h-16 flex-1 items-end gap-2">
                {shots.map((shot, i) => (
                  <li key={shot.id}>
                    <button
                      type="button"
                      onClick={() => removeShot(shot.id)}
                      aria-label={`Remove photo ${i + 1}`}
                      className="group relative block size-16 overflow-hidden rounded-xl ring-2 ring-white/80"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                      <img src={shot.url} alt="" className="size-full object-cover" />
                      <span className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-black/70">
                        <X aria-hidden className="size-3.5" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
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
                  "grid size-14 shrink-0 touch-none place-items-center rounded-full bg-white/15 backdrop-blur-sm transition-colors select-none [-webkit-touch-callout:none]",
                  listening && "animate-pulse-soft bg-red-600",
                )}
              >
                <Mic aria-hidden className="size-6" />
              </button>
            </div>

            {(note || heard) && !typing && (
              <p
                dir="auto"
                className="text-body mt-2 line-clamp-2 text-white/90"
                data-testid="capture-note"
              >
                {heard || note}
              </p>
            )}
            {listening && !heard && (
              <p className="text-caption mt-2 text-white/75">
                Listening… let go when you are done.
              </p>
            )}

            <div className="mt-4 grid grid-cols-3 items-center">
              <div className="flex justify-start">
                <button
                  type="button"
                  onClick={() => gallery.current?.click()}
                  disabled={full || busy}
                  aria-label="Pick photos from the gallery"
                  className="grid size-14 place-items-center rounded-full bg-white/15 backdrop-blur-sm disabled:opacity-40"
                >
                  <Images aria-hidden className="size-6" />
                </button>
              </div>
              <div className="flex justify-center">
                <button
                  ref={shutter}
                  type="button"
                  onClick={() => void takePhoto()}
                  disabled={state !== "live" || full || busy}
                  aria-label={full ? "Three photos taken, the most for one meal" : "Take photo"}
                  className="grid size-20 place-items-center rounded-full border-4 border-white transition-transform active:scale-95 disabled:opacity-40"
                >
                  <span className="block size-16 rounded-full bg-white" />
                </button>
              </div>
              <div className="flex justify-end">
                <button
                  ref={sendButton}
                  type="button"
                  onClick={send}
                  disabled={!shots.length || busy}
                  aria-label={
                    shots.length
                      ? `Send meal with ${shots.length} ${shots.length === 1 ? "photo" : "photos"}`
                      : "Send meal (take a photo first)"
                  }
                  className="bg-primary text-on-primary text-label inline-flex min-h-14 items-center gap-2 rounded-full px-5 shadow-lg disabled:bg-white/15 disabled:text-white/60"
                >
                  Send <Send aria-hidden className="size-4" />
                </button>
              </div>
            </div>
          </div>

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
              void addPhotos(files, new Date());
            }}
          />
          <input
            ref={gallery}
            type="file"
            accept="image/*"
            multiple
            hidden
            data-testid="gallery-input"
            aria-label="Photos from the gallery"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              void addPhotos(files, null);
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
