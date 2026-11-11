"use client";

import { Camera, ImageIcon, Loader2, Plus, X } from "lucide-react";
import { useRef, useState } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { api, type MealPhotosChange } from "@/lib/client/api";
import { UPLOAD_LIMITS, type MealDto, type MealPhotoDto } from "@/lib/contracts/meals";
import { preparePhoto } from "@/lib/photos/client";
import { useOnline } from "@/lib/ui/hooks";

const MAX = UPLOAD_LIMITS.maxPhotos;

export const PHOTOS_SWITCH_HINT = {
  off: "Off: added or removed photos are kept for the record; items and calories stay as they are.",
  on: "On: after a change Cal analyses the meal again from its photos; items you changed by hand stay.",
} as const;

/**
 * The meal's photos as tiles (the meal page): tap one to make it the cover (the photo the timeline
 * card and the page header show), remove one, or add one from the camera or the gallery. Any meal
 * can get photos. "Update items from the photos" is off by default: then only the photos change;
 * on, the meal is analysed again from its photos after each change. These changes need a
 * connection.
 */
export const MealPhotos = ({
  meal,
  onChange,
}: {
  meal: Pick<MealDto, "id" | "photos">;
  onChange: (change: MealPhotosChange) => void;
}) => {
  const { show } = useToast();
  const online = useOnline();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [reanalyse, setReanalyse] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ photo: MealPhotoDto; number: number } | null>(null);

  const photos = meal.photos;
  const full = photos.length >= MAX;
  const locked = busy !== null || !online;

  const settle = (change: MealPhotosChange, title: string) => {
    onChange(change);
    if (change.notice)
      show({ title: `${title}. The items were not updated`, body: change.notice, tone: "neutral" });
    else
      show({
        title,
        body: change.reanalysed ? "Cal is updating the items from the photos." : undefined,
        tone: "success",
      });
  };

  const fail = (title: string, error: unknown) =>
    show({ title, body: error instanceof Error ? error.message : undefined, tone: "error" });

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

  const makeCover = async (photo: MealPhotoDto) => {
    setBusy(`cover:${photo.id}`);
    try {
      settle(await api.setMealCover(meal.id, photo.id, reanalyse), "Cover changed");
    } catch (error) {
      fail("The cover was not changed", error);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (photo: MealPhotoDto) => {
    setBusy(`remove:${photo.id}`);
    try {
      settle(await api.removeMealPhoto(meal.id, photo.id, reanalyse), "Photo removed");
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

  return (
    <section aria-labelledby="meal-photos-heading" className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="meal-photos-heading" className="text-body font-semibold">
          Photos
        </h2>
        <p className="text-caption text-muted" data-testid="photo-count">
          {photos.length} of {MAX}
          {photos.length > 1 && " · tap to choose the cover"}
        </p>
      </div>
      <ul aria-labelledby="meal-photos-heading" className="grid grid-cols-4 gap-2">
        {photos.map((photo, index) => {
          const cover = index === 0;
          const number = index + 1;
          return (
            <li key={photo.id} className="relative" data-photo-id={photo.id}>
              <button
                type="button"
                aria-pressed={cover}
                aria-label={
                  cover ? `Photo ${number}, the cover` : `Photo ${number}, make it the cover`
                }
                disabled={!cover && locked}
                onClick={() => !cover && void makeCover(photo)}
                className={cn(
                  "bg-surface-2 block aspect-square w-full overflow-hidden rounded-[0.875rem] p-0 disabled:cursor-not-allowed",
                  cover ? "border-primary border-3" : "border-border border",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin photo */}
                <img
                  src={photo.urls.thumb}
                  alt=""
                  className="size-full object-cover"
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
            ? "The photo is deleted, and Cal analyses the meal again from the photos left."
            : "The photo is deleted. Items and calories stay as they are."
        }
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
