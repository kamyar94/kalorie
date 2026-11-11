"use client";

import { ChevronLeft, Download, HeartPulse, Smartphone } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { Logo } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { readAppContext, rememberAppContext } from "@/lib/client/android-app";
import { api } from "@/lib/client/api";
import {
  androidVersionName,
  formatBytes,
  HEALTH_CONNECT_MIN_SDK,
  type AndroidRelease,
  type AppContext,
} from "@/lib/contracts/android";
import { sendsLine, type DeviceDto } from "@/lib/contracts/devices";
import type { HealthConnectKeptDto } from "@/lib/contracts/health-connect";

/** A linked phone with the time it last sent, worded on the server in the viewer's zone. */
export type PhoneRow = DeviceDto & { lastSent: string | null };

const STEPS = [
  "Open the downloaded file. Android asks once whether Chrome may install apps: allow it.",
  "Android says the app is not from the Play Store. That is expected: Kal comes from your own server.",
];

/** Where the page runs: unknown until the browser has said (the first render is the server's). */
type Place = { known: false } | ({ known: true; android: boolean } & AppContext);

const keptLine = (kept: HealthConnectKeptDto) => {
  const parts = [
    kept.restingDays ? `${kept.restingDays} days of resting heart rate` : null,
    kept.workoutHeartRates
      ? `heart rate of ${kept.workoutHeartRates} workout${kept.workoutHeartRates === 1 ? "" : "s"}`
      : null,
    kept.sleepNights
      ? `${kept.sleepNights} night${kept.sleepNights === 1 ? "" : "s"} of sleep`
      : null,
  ].filter(Boolean);
  return parts.length ? `Kept so far: ${parts.join(", ")}.` : null;
};

/**
 * "Kal for Android" (board 13): the app to download with its version and size, how to install
 * it, the linked phones (Unlink), "Connect Health Connect" inside the app ("Open in the Kal app"
 * in a browser on Android), and what the app sends.
 */
export const AndroidView = ({
  release,
  phones: initialPhones,
  kept,
  appId,
}: {
  release: AndroidRelease | null;
  phones: PhoneRow[];
  kept: HealthConnectKeptDto;
  appId: string | null;
}) => {
  const id = useId();
  const { show } = useToast();
  const [place, setPlace] = useState<Place>({ known: false });
  const [phones, setPhones] = useState(initialPhones);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [intentUrl, setIntentUrl] = useState<string | null>(null);

  useEffect(() => {
    rememberAppContext();
    const context = readAppContext();
    const timer = window.setTimeout(() =>
      setPlace({ known: true, android: /Android/i.test(navigator.userAgent), ...context }),
    );
    return () => window.clearTimeout(timer);
  }, []);

  const fail = (title: string, error: unknown) =>
    show({ title, body: error instanceof Error ? error.message : undefined, tone: "error" });

  const connect = async () => {
    setBusy("connect");
    try {
      const link = await api.createLinkCode();
      setIntentUrl(link.intentUrl);
      window.location.assign(link.intentUrl);
    } catch (error) {
      fail("Not connected", error);
    } finally {
      setBusy(null);
    }
  };

  const unlink = async (phone: PhoneRow) => {
    setBusy(`unlink:${phone.id}`);
    try {
      await api.unlinkDevice(phone.id);
      setPhones((list) => list.filter((p) => p.id !== phone.id));
      setConfirming(null);
      show({
        title: `${phone.name} unlinked`,
        body: "It sends nothing more. Link it again from the app at any time.",
        tone: "success",
      });
    } catch (error) {
      fail("Not unlinked", error);
    } finally {
      setBusy(null);
    }
  };

  const inApp = place.known && place.inApp;
  const upToDate =
    inApp && release && place.appVersion !== null && place.appVersion >= release.versionCode;
  const newer = inApp && release && place.appVersion !== null && !upToDate;
  const openInApp =
    place.known && appId
      ? `intent://${location.host}/more/android#Intent;scheme=https;package=${appId};S.browser_fallback_url=${encodeURIComponent(`${location.origin}/more/android`)};end`
      : null;

  const connectArea = () => {
    if (!place.known) return <div className="min-h-12" aria-hidden />;
    if (!appId)
      return (
        <p className="text-caption text-muted" data-testid="android-connect-note">
          The Android app is not set up on this server yet.
        </p>
      );
    if (place.inApp && !place.healthConnect)
      return (
        <p className="text-caption text-muted" data-testid="android-connect-note">
          Health Connect needs Android 9 or newer. On this phone Kal works without it: everything
          else is the same.
        </p>
      );
    if (place.inApp)
      return (
        <>
          <Button
            variant="secondary"
            size="md"
            fullWidth
            loading={busy === "connect"}
            onClick={connect}
            className="border-primary text-primary bg-surface hover:bg-primary-soft border"
          >
            <HeartPulse aria-hidden className="size-5" />
            Connect Health Connect
          </Button>
          {intentUrl && (
            <p className="text-caption text-muted">
              Nothing opened?{" "}
              <a href={intentUrl} className="text-primary font-semibold underline">
                Open Kal&apos;s Health Connect screen
              </a>
            </p>
          )}
        </>
      );
    if (place.android && openInApp)
      return (
        <Button
          asChild
          variant="secondary"
          size="md"
          fullWidth
          className="border-primary text-primary bg-surface hover:bg-primary-soft border"
        >
          <a href={openInApp}>
            <Smartphone aria-hidden className="size-5" />
            Open in the Kal app
          </a>
        </Button>
      );
    return (
      <p className="text-caption text-muted" data-testid="android-connect-note">
        Health Connect is linked from the app: open this page in the Kal app on your Android phone
        and tap Connect Health Connect there.
      </p>
    );
  };

  const keptText = keptLine(kept);

  return (
    <>
      <div className="flex items-center gap-2">
        <Link
          href="/more"
          aria-label="Back to More"
          className="bg-surface-2 hover:bg-surface-3 grid size-11 shrink-0 place-items-center rounded-full"
        >
          <ChevronLeft aria-hidden className="size-5" />
        </Link>
        <h1 className="text-title min-w-0 flex-1">Kal for Android</h1>
      </div>

      <div className="mt-4 grid max-w-4xl grid-cols-1 gap-3.5 md:grid-cols-2 md:items-start">
        <Card as="section" aria-labelledby={`${id}-get`} className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Logo className="size-14 shrink-0" />
            <div className="min-w-0 flex-1">
              <h2 id={`${id}-get`} className="text-headline">
                Everything in Kal, plus your watch
              </h2>
              <p className="text-caption text-muted" data-testid="android-release">
                {release
                  ? `Version ${release.versionName} · ${formatBytes(release.size)} · Android ${androidVersionName(release.minSdk)} or newer`
                  : "The Android app is not set up on this server yet."}
              </p>
            </div>
          </div>
          <p className="text-body">
            The app opens the same Kal you use now and adds one thing a browser cannot do: it reads{" "}
            <b>Health Connect</b>, where Samsung Health, your Galaxy watch and Renpho keep your
            steps, workouts, heart rate, sleep and weigh-ins.
          </p>
          {release && upToDate && (
            <p className="text-caption text-muted">You have this version, the newest there is.</p>
          )}
          {release && newer && (
            <p className="bg-warning-soft text-on-warning-soft text-caption rounded-xl px-3 py-2">
              A newer version of the app is ready. Download it and open the file to update.
            </p>
          )}
          {release && !upToDate && (
            <Button asChild size="lg" fullWidth>
              <a href="/android/kal.apk" download>
                <Download aria-hidden className="size-5" />
                Download the app
              </a>
            </Button>
          )}
        </Card>

        {!inApp && release && (
          <Card as="section" aria-labelledby={`${id}-steps`} className="flex flex-col gap-2.5">
            <h2 id={`${id}-steps`} className="text-headline">
              Installing it
            </h2>
            <ol className="text-body flex flex-col gap-2.5">
              {[...STEPS, null].map((step, index) => (
                <li key={index} className="flex gap-2.5">
                  <span
                    aria-hidden
                    className="bg-primary-soft text-on-primary-soft grid size-6.5 shrink-0 place-items-center rounded-full text-sm font-bold"
                  >
                    {index + 1}
                  </span>
                  <span>
                    {step ?? (
                      <>
                        Open Kal from the home screen and sign in as usual. Then come back here and
                        tap <b>Connect Health Connect</b>.
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        )}

        <Card as="section" aria-labelledby={`${id}-phones`} className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <h2 id={`${id}-phones`} className="text-headline min-w-0 flex-1">
              Your phones
            </h2>
            {phones.length > 0 && (
              <span className="bg-primary-soft text-on-primary-soft text-caption rounded-full px-2.5 py-1 font-semibold">
                {phones.length} linked
              </span>
            )}
          </div>
          {phones.length === 0 ? (
            <p className="text-caption text-muted">No phone is linked yet.</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="android-phones">
              {phones.map((phone) => (
                <li
                  key={phone.id}
                  className="border-border flex flex-col gap-2 rounded-2xl border p-3"
                  data-testid="android-phone"
                >
                  <div className="flex items-center gap-3">
                    <Smartphone aria-hidden className="text-muted size-7 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-body font-semibold wrap-break-word">{phone.name}</p>
                      <p className="text-caption text-muted">
                        {phone.lastSent
                          ? `Last sent ${phone.lastSent}${phone.sends.length ? ` · ${sendsLine(phone.sends)}` : ""}`
                          : "Linked, nothing sent yet"}
                      </p>
                    </div>
                    {confirming !== phone.id && (
                      <Button
                        variant="secondary"
                        className="text-danger"
                        aria-label={`Unlink ${phone.name}`}
                        onClick={() => setConfirming(phone.id)}
                      >
                        Unlink
                      </Button>
                    )}
                  </div>
                  {confirming === phone.id && (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <p className="text-caption text-muted min-w-0 flex-1">
                        The phone stops sending until you link it again.
                      </p>
                      <Button variant="ghost" onClick={() => setConfirming(null)}>
                        Keep it
                      </Button>
                      <Button
                        variant="danger"
                        loading={busy === `unlink:${phone.id}`}
                        onClick={() => unlink(phone)}
                      >
                        Unlink this phone
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {connectArea()}
        </Card>

        <Card as="section" aria-labelledby={`${id}-what`} className="flex flex-col gap-2">
          <h2 id={`${id}-what`} className="text-headline">
            What the app sends
          </h2>
          <ul className="text-body list-disc pl-5">
            <li>
              Steps and workouts go to <b>Move</b>.
            </li>
            <li>
              Weight and body composition go to <b>Body</b>.
            </li>
            <li>Heart rate and sleep are kept for later charts.</li>
          </ul>
          {keptText && (
            <p className="text-caption text-muted" data-testid="android-kept">
              {keptText}
            </p>
          )}
          <p className="text-caption text-muted">
            Only to your Kal server, about once an hour and when you open the app. Read-only: Kal
            never writes to Health Connect. Withdraw access any time in Health Connect.
            {release && release.minSdk < HEALTH_CONNECT_MIN_SDK
              ? " Health Connect needs Android 9 or newer."
              : ""}
          </p>
        </Card>
      </div>
    </>
  );
};
