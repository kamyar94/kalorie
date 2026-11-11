"use client";

import { Expand } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "@/components/ui/cn";
import type { MealPhotoDto } from "@/lib/contracts/meals";

import { PhotoViewer } from "./photo-viewer";

/** The meal's photos side by side: swipe between them, tap one to open it full screen. */
export const PhotoCarousel = ({ photos, title }: { photos: MealPhotoDto[]; title: string }) => {
  const strip = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const [viewer, setViewer] = useState<number | null>(null);
  if (!photos.length) return null;

  const scrollTo = (index: number) => {
    const el = strip.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: "smooth" });
  };

  return (
    <section aria-label="Meal photos" className="relative">
      <div
        ref={strip}
        data-no-swipe
        onScroll={(event) => {
          const el = event.currentTarget;
          setCurrent(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        className="bg-surface-2 flex snap-x snap-mandatory [scrollbar-width:none] overflow-x-auto overscroll-x-contain rounded-[var(--radius-card)] motion-safe:scroll-smooth [&::-webkit-scrollbar]:hidden"
      >
        {photos.map((photo, i) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => setViewer(i)}
            aria-label={`Open photo ${i + 1} of ${photos.length} full screen`}
            className="relative aspect-[4/3] w-full shrink-0 snap-center md:aspect-[16/10]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin photo */}
            <img
              src={photo.urls.analysis}
              alt={i === 0 ? `Photo of ${title}` : ""}
              className="size-full object-cover"
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
            />
          </button>
        ))}
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute top-3 right-3 grid size-9 place-items-center rounded-full bg-black/50 text-white"
      >
        <Expand className="size-4" />
      </span>
      {photos.length > 1 && (
        <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
          {photos.map((photo, i) => (
            <button
              key={photo.id}
              type="button"
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === current || undefined}
              onClick={() => scrollTo(i)}
              className="grid size-6 place-items-center"
            >
              <span
                className={cn(
                  "block size-2 rounded-full bg-white/60 shadow transition-all",
                  i === current && "w-4 bg-white",
                )}
              />
            </button>
          ))}
        </div>
      )}
      <PhotoViewer
        photos={photos}
        index={viewer}
        onIndexChange={setViewer}
        onClose={() => setViewer(null)}
      />
    </section>
  );
};
