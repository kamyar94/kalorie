import type { Metadata } from "next";

import { AndroidView, type PhoneRow } from "@/components/android/android-view";
import { androidConfig } from "@/lib/android/config";
import { readAndroidRelease } from "@/lib/android/release";
import { requireUser } from "@/lib/auth/session";
import { listDevices } from "@/lib/devices/service";
import { keptHealthConnect } from "@/lib/health-connect/sync";
import { localParts } from "@/lib/meals/time";
import { dayTitle } from "@/lib/ui/format";
import { viewerTimeZone } from "@/lib/ui/viewer-time";

export const metadata: Metadata = { title: "Kal for Android" };

/** "Kal for Android" (board 13): the app to download, the linked phones, what the app sends. */
export default async function AndroidPage() {
  const user = await requireUser();
  const config = androidConfig();
  const [release, phones, kept, zone] = await Promise.all([
    readAndroidRelease(config),
    listDevices(user.id),
    keptHealthConnect(user.id),
    viewerTimeZone(user.timeZone),
  ]);
  const today = localParts(new Date(), zone).date;
  const when = (iso: string) => {
    const at = localParts(new Date(iso), zone);
    return at.date === today ? at.time : `${dayTitle(at.date, today)}, ${at.time}`;
  };
  const rows: PhoneRow[] = phones.map((phone) => ({
    ...phone,
    lastSent: phone.lastSyncAt ? when(phone.lastSyncAt) : null,
  }));
  return <AndroidView release={release} phones={rows} kept={kept} appId={config.appId} />;
}
