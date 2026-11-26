"use client";

import { Camera, ImageIcon, Loader2, Plus, X } from "lucide-react";
import { useRef, useState } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { HoldRing } from "@/components/ui/hold-ring";
import { PhotoViewer, viewerButton, type ViewerStatus } from "@/components/ui/photo-viewer";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { useHoldPress } from "@/components/ui/use-hold-press";
import { api, type MealPhotosChange } from "@/lib/client/api";
import { UPLOAD_LIMITS, type MealDto, type MealPhotoDto } from "@/lib/contracts/meals";
import { preparePhoto } from "@/lib/photos/client";
import { useOnline } from "@/lib/ui/hooks";

const MAX = UPLOAD_LIMITS.maxPhotos;

export const PHOTOS_SWITCH_HINT = {
  off: "Off: added or removed photos are kept for the record; items and calories stay as they are.",
  on: "On: after a change Kal analyses the meal again from its photos; items you changed by hand stay.",
} as const;

const errorText = (error: unknown) => (error instanceof Error ? error.message : undefined);

/**
 * The meal's photos as tiles (the meal page, boards 49 and 50): tap one to see it larger in the
 * viewer (with "Make it the cover" and "Remove photo"); touch and hold one (press and hold with
 * the mouse) to make it the cover (the photo the timeline card and the page header show), with
 * Undo; remove one, or add one from the camera or the gallery. Any meal can get photos. "Update
 * items from the photos" is off by default: then only the photos change; on, the meal is
 * analysed again from its photos after each change. These changes need a connection.
 */
export const MealPhotos = ({
  meal,
  subtitle,
  onChange,
}: {
  meal: Pick<MealDto, "id" | "photos">;
  /** "Rice plate · 12:48", under "Photo n of k" in the viewer. */
  subtitle?: string;
  onChange: (change: MealPhotosChange) => void;
}) => {
  const { show } = useToast();
  const online = useOnline();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const viewerRemove = useRef<HTMLButtonElement>(null);
  /** Where focus goes when the viewer or the remove sheet closes, when not back to its opener. */
  const focusAfter = useRef<HTMLElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [reanalyse, setReanalyse] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ photo: MealPhotoDto; number: number } | null>(null);
  /** The photo open larger (its id), and the viewer's own line. */
  const [viewing, setViewing] = useState<string | null>(null);
  const [viewerStatus, setViewerStatus] = useState<ViewerStatus>(null);

  const photos = meal.photos;
  const full = photos.length >= MAX;
  const locked = busy !== null || !online;
  const viewedIndex = viewing ? photos.findIndex((photo) => photo.id === viewing) : -1;
  const viewed = viewedIndex >= 0 ? photos[viewedIndex] : undefined;

  const settle = (
    change: MealPhotosChange,
    title: string,
    action?: { label: string; onClick: () => void },
  ) => {
    onChange(change);
    if (change.notice)
      show({
        title: `${title}. The items were not updated`,
        body: change.notice,
        tone: "neutral",
        action,
        duration: action ? 8000 : undefined,
      });
    else
      show({
        title,
        body: change.reanalysed ? "Kal is updating the items from the photos." : undefined,
        tone: "success",
        action,
        duration: action ? 8000 : undefined,
      });
  };

  const fail = (title: string, error: unknown) =>
    show({ title, body: errorText(error), tone: "error" });

  const add = async (files: File[]) => {
    const room = MAX - photos.length;
    if (!files.length || room <= 0) return;
    setBusy("add");
    try {
      const prepared = [];
      for (const file of files.slice(0, room)) prepared.push((await preparePhoto(file)).blob);
      const change = await api.addMealPhotos(meal.id, prepared, reanalyse);
      settle(change, prepared.length === 1 ? "Photo added" : `${prepared.length} photos added`);
      if (files.length > room) show({ title: `Only ${MAX} photos fit in one meal.` });
    } catch (error) {
      fail("The photo was not added", error);
    } finally {
      setBusy(null);
    }
  };

  /** Puts the photos back in the order they had: Undo after a cover change. */
  const restore = async (order: string[], inViewer: boolean) => {
    setBusy("cover:undo");
    try {
      const change = await api.setMealPhotoOrder(meal.id, order, reanalyse);
      if (inViewer) {
        onChange(change);
        setViewerStatus({ text: "The cover is as it was." });
      } else settle(change, "The cover is as it was");
    } catch (error) {
      if (inViewer)
        setViewerStatus({ text: `The cover was not changed back. ${errorText(error) ?? ""}` });
      else fail("The cover was not changed back", error);
    } finally {
      setBusy(null);
    }
  };

  /** A hold or the viewer's button: the photo becomes the cover, with Undo. */
  const makeCover = async (photo: MealPhotoDto, inViewer: boolean) => {
    const before = photos.map((p) => p.id);
    setBusy(`cover:${photo.id}`);
    try {
      const change = await api.setMealCover(meal.id, photo.id, reanalyse);
      const undo = () => void restore(before, inViewer);
      if (inViewer) {
        onChange(change);
        setViewerStatus({
          text: change.notice
            ? `Cover changed. The items were not updated: ${change.notice}`
            : change.reanalysed
              ? "Cover changed. Kal is updating the items from the photos."
              : "Cover changed.",
          onUndo: undo,
        });
        // The button goes (this photo is the cover now): focus the next one.
        requestAnimationFrame(() => viewerRemove.current?.focus());
      } else settle(change, "Cover changed", { label: "Undo", onClick: undo });
    } catch (error) {
      if (inViewer)
        setViewerStatus({ text: `The cover was not changed. ${errorText(error) ?? ""}` });
      else fail("The cover was not changed", error);
    } finally {
      setBusy(null);
    }
  };

  const hold = useHoldPress({
    canHold: (id) => !locked && photos.length > 1 && photos[0]?.id !== id,
    onHold: (id) => {
      const photo = photos.find((p) => p.id === id);
      if (photo) void makeCover(photo, false);
    },
  });

  const remove = async (photo: MealPhotoDto) => {
    setBusy(`remove:${photo.id}`);
    try {
      const change = await api.removeMealPhoto(meal.id, photo.id, reanalyse);
      settle(change, "Photo removed");
      if (viewing === photo.id) {
        // The viewer shows the photo that took its place, or closes after the last one.
        const left = change.meal.photos;
        const next = left[Math.min(viewedIndex, left.length - 1)];
        setViewerStatus(null);
        setViewing(next?.id ?? null);
        if (!next) focusAfter.current = addButton.current;
      } else focusAfter.current = addButton.current;
      setRemoving(null);
    } catch (error) {
      fail("The photo was not removed", error);
    } finally {
      setBusy(null);
    }
  };

  const pick = (input: React.RefObject<HTMLInputElement | null>) => {
    // Opened from the button press itself, so the browser allows the file picker.
    input.current?.click();
    setAdding(false);
  };

  /** Sends focus to focusAfter instead of the element that opened the layer, when set. */
  const focusInstead = (event: Event) => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    event.preventDefault();
    requestAnimationFrame(() => target.focus());
  };

  /** The viewer gives the focus back to the photo it was opened from (a tap may not focus it). */
  const viewerClosed = (event: Event) => {
    if (!focusAfter.current && opener.current?.isConnected) focusAfter.current = opener.current;
    opener.current = null;
    focusInstead(event);
  };

  return (
    <section aria-labelledby="meal-photos-heading" className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="meal-photos-heading" className="text-body font-semibold">
          Photos
        </h2>
        <p className="text-caption text-muted text-right" data-testid="photo-count">
          {photos.length} of {MAX}
          {photos.length > 1
            ? " · tap to see larger, hold to make the cover"
            : photos.length === 1 && " · tap to see larger"}
        </p>
      </div>
      <ul aria-labelledby="meal-photos-heading" className="grid grid-cols-4 gap-2">
        {photos.map((photo, index) => {
          const cover = index === 0;
          const number = index + 1;
          const press = hold.press?.id === photo.id ? hold.press : null;
          return (
            <li key={photo.id} className="relative" data-photo-id={photo.id}>
              <button
                type="button"
                aria-label={`Photo ${number}${cover ? ", the cover" : ""}: open it larger`}
                aria-haspopup="dialog"
                onPointerDown={(event) => hold.onPointerDown(photo.id, event)}
                onClick={(event) => {
                  if (hold.ignoreClick()) return;
                  opener.current = event.currentTarget;
                  setViewerStatus(null);
                  setViewing(photo.id);
                }}
                onContextMenu={(event) => event.preventDefault()}
                className={cn(
                  "bg-surface-2 block aspect-square w-full overflow-hidden rounded-[0.875rem] p-0 transition-transform select-none [-webkit-touch-callout:none]",
                  cover || press?.held ? "border-primary border-3" : "border-border border",
                  press?.held && "scale-[1.06]",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin photo */}
                <img
                  src={photo.urls.thumb}
                  alt=""
                  draggable={false}
                  className="pointer-events-none size-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              </button>
              {cover && (
                <span
                  aria-hidden
                  className="bg-primary text-on-primary pointer-events-none absolute bottom-1.5 left-1.5 rounded-full px-1.5 py-0.5 text-[0.6875rem] leading-none font-semibold"
                >
                  Cover
                </span>
              )}
              {press && (
                <HoldRing
                  startedAt={press.startedAt}
                  held={press.held}
                  className={press.held ? "scale-[1.06]" : undefined}
                />
              )}
              {busy === `cover:${photo.id}` && (
                <span className="pointer-events-none absolute inset-0 grid place-items-center rounded-[0.875rem] bg-black/35">
                  <Loader2
                    aria-hidden
                    className="size-5 animate-spin text-white motion-reduce:animate-none"
                  />
                </span>
              )}
              {/* A 44 px target; the visible circle sits on the tile's corner, as on the design. */}
              <button
                type="button"
                aria-label={`Remove photo ${number}`}
                disabled={locked}
                onClick={() => setRemoving({ photo, number })}
                className="group absolute -top-2 -right-2 size-11 disabled:opacity-50"
              >
                <span className="border-bg bg-text text-bg absolute top-0 right-0 grid size-7 place-items-center rounded-full border-2">
                  <X aria-hidden className="size-3.5" strokeWidth={3} />
                </span>
              </button>
            </li>
          );
        })}
        <li>
          <button
            ref={addButton}
            type="button"
            aria-label={full ? `Add a photo (${MAX} is the most for one meal)` : "Add a photo"}
            aria-haspopup="dialog"
            aria-busy={busy === "add" || undefined}
            disabled={full || locked}
            onClick={() => setAdding(true)}
            className="border-border text-muted hover:bg-surface-2 flex aspect-square w-full flex-col items-center justify-center gap-0.5 rounded-[0.875rem] border-2 border-dashed text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-55"
          >
            {busy === "add" ? (
              <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
            ) : (
              <Plus aria-hidden className="size-5" />
            )}
            Add
          </button>
        </li>
      </ul>
      {!online && (
        <p className="text-caption text-muted" role="status">
          You are offline. Photos can be added, removed or reordered once you are back online.
        </p>
      )}
      <div className="border-border bg-surface rounded-2xl border px-3.5 py-1.5">
        <Switch
          label="Update items from the photos"
          labelClassName="text-[0.9375rem] font-semibold"
          hint={reanalyse ? PHOTOS_SWITCH_HINT.on : PHOTOS_SWITCH_HINT.off}
          checked={reanalyse}
          onChange={setReanalyse}
        />
      </div>

      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-testid="meal-camera-input"
        aria-label="Take a photo with the phone camera"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void add(files);
        }}
      />
      <input
        ref={gallery}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-testid="meal-gallery-input"
        aria-label="Photos from the gallery"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void add(files);
        }}
      />

      <PhotoViewer
        photos={photos.map((photo, i) => ({
          id: photo.id,
          src: photo.urls.original,
          alt: `Photo ${i + 1} of ${photos.length}`,
        }))}
        index={viewed ? viewedIndex : null}
        onIndexChange={(index) => {
          const next = photos[index];
          if (!next) return;
          setViewerStatus(null);
          setViewing(next.id);
        }}
        onClose={() => {
          setViewing(null);
          setViewerStatus(null);
        }}
        onCloseAutoFocus={viewerClosed}
        subtitle={subtitle}
        status={viewerStatus}
        actions={
          viewed && (
            <>
              {viewedIndex > 0 && (
                <button
                  type="button"
                  disabled={locked}
                  aria-busy={busy === `cover:${viewed.id}` || undefined}
                  onClick={() => void makeCover(viewed, true)}
                  className={viewerButton(true)}
                >
                  {busy === `cover:${viewed.id}` && (
                    <Loader2
                      aria-hidden
                      className="size-4 animate-spin motion-reduce:animate-none"
                    />
                  )}
                  Make it the cover
                </button>
              )}
              <button
                ref={viewerRemove}
                type="button"
                aria-haspopup="dialog"
                disabled={locked}
                onClick={() => setRemoving({ photo: viewed, number: viewedIndex + 1 })}
                className={viewerButton(false)}
              >
                Remove photo
              </button>
            </>
          )
        }
      />

      <BottomSheet
        open={adding}
        onOpenChange={setAdding}
        title="Add a photo"
        description={`A meal holds up to ${MAX} photos.`}
      >
        <div className="flex flex-col gap-2 py-1">
          <Button size="lg" fullWidth onClick={() => pick(camera)}>
            <Camera aria-hidden className="size-5" /> Take a photo
          </Button>
          <Button size="lg" variant="secondary" fullWidth onClick={() => pick(gallery)}>
            <ImageIcon aria-hidden className="size-5" /> From the gallery
          </Button>
        </div>
      </BottomSheet>
      <BottomSheet
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing ? `Remove photo ${removing.number}?` : "Remove the photo?"}
        description={
          reanalyse
            ? "The photo is deleted, and Kal analyses the meal again from the photos left."
            : "The photo is deleted. Items and calories stay as they are."
        }
        elevated={viewing !== null}
        onCloseAutoFocus={focusInstead}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              size="lg"
              loading={removing !== null && busy === `remove:${removing.photo.id}`}
              onClick={() => removing && void remove(removing.photo)}
            >
              Remove
            </Button>
          </div>
        }
      >
        {removing && (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin photo
          <img
            src={removing.photo.urls.thumb}
            alt={`Photo ${removing.number}`}
            className="mx-auto mb-2 size-32 rounded-2xl object-cover"
          />
        )}
      </BottomSheet>
    </section>
  );
};
