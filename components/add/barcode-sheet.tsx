"use client";

import { Keyboard, ScanBarcode } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { createBarcodeReader } from "@/lib/client/barcode";

type ScanState = "starting" | "scanning" | "no-camera" | "no-reader";

/**
 * Scans a product barcode with the rear camera (BarcodeDetector, or the ZXing WebAssembly reader)
 * and hands the digits on. The numbers can always be typed instead.
 */
export const BarcodeSheet = ({
  open,
  onOpenChange,
  onCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCode: (code: string) => void;
}) => {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ScanState>("starting");
  const [typed, setTyped] = useState("");
  const id = useId();

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer = 0;
    const run = async () => {
      setState("starting");
      const reader = await createBarcodeReader();
      if (stopped) return;
      if (!reader) return setState("no-reader");
      if (!navigator.mediaDevices?.getUserMedia) return setState("no-camera");
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
        });
      } catch {
        if (!stopped) setState("no-camera");
        return;
      }
      if (stopped || !video.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.current.srcObject = stream;
      await video.current.play().catch(() => undefined);
      setState("scanning");
      const tick = async () => {
        if (stopped || !video.current) return;
        try {
          const code = await reader.read(video.current);
          if (code && !stopped) {
            stopped = true;
            navigator.vibrate?.(40);
            onCode(code);
            return;
          }
        } catch {
          // Try the next frame.
        }
        timer = window.setTimeout(() => void tick(), 250);
      };
      void tick();
    };
    void run();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, onCode]);

  const digits = typed.replace(/\D/g, "");

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Scan a barcode"
      description="Hold the barcode inside the frame. It is read on this device."
    >
      <div className="flex flex-col gap-4 py-1" data-testid="barcode-sheet" data-scan-state={state}>
        <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-black">
          <video
            ref={video}
            playsInline
            muted
            autoPlay
            aria-hidden
            className="size-full object-cover"
          />
          {state === "scanning" && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-white/85"
            />
          )}
          {state !== "scanning" && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-white">
              <div>
                <ScanBarcode aria-hidden className="mx-auto size-8 opacity-80" />
                <p className="text-body mt-2" role="status">
                  {state === "starting"
                    ? "Starting the camera…"
                    : state === "no-camera"
                      ? "The camera is not available. Type the numbers below."
                      : "This browser cannot read barcodes. Type the numbers below."}
                </p>
              </div>
            </div>
          )}
        </div>
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (digits.length >= 8) onCode(digits);
          }}
        >
          <label htmlFor={id} className="text-label inline-flex items-center gap-1.5">
            <Keyboard aria-hidden className="size-4" /> Or type the numbers under the barcode
          </label>
          <div className="flex gap-2">
            <input
              id={id}
              inputMode="numeric"
              autoComplete="off"
              maxLength={18}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              className="border-border bg-surface tabular text-body focus:border-primary min-h-12 min-w-0 flex-1 rounded-[var(--radius-control)] border px-3.5 tracking-wider focus:outline-none focus-visible:outline-3 focus-visible:outline-[var(--focus)]"
            />
            <Button type="submit" size="lg" disabled={digits.length < 8}>
              Look up
            </Button>
          </div>
        </form>
      </div>
    </BottomSheet>
  );
};
