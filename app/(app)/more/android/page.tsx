import type { Metadata } from "next";

import { AndroidView, type PhoneRow } from "@/components/android/android-view";
import { androidConfig } from "@/lib/android/config";
import { readAndroidRelease } from "@/lib/android/release";
import { requireUser } from "@/lib/auth/session";
import { listDevices } from "@/lib/devices/service";
import { hasHealthConnectRecords, listUpdates } from "@/lib/health-connect/log";
import { updateSummary } from "@/lib/health-connect/summary";
import { keptHealthConnect } from "@/lib/health-connect/sync";
import { localParts, shiftLocalDate } from "@/lib/meals/time";
import { shortDate } from "@/lib/ui/format";
import { viewerTimeZone } from "@/lib/ui/viewer-time";

export const metadata: Metadata = { title: "Kal for Android" };

/** How many updates "Recent updates" lists per phone. */
const RECENT_UPDATES = 10;

/**
 * "Kal for Android" (boards 13 and 34): the app to download, the linked phones with their recent
 * updates and a warning while a phone sends but no Health Connect record is stored, and what the
 * app sends. Times are worded here, in the viewer's zone.
 */
export default async function AndroidPage() {
  const user = await requireUser();
  const config = androidConfig();
  const [release, phones, kept, zone, hasRecords] = await Promise.all([
    readAndroidRelease(config),
    listDevices(user.id),
    keptHealthConnect(user.id),
    viewerTimeZone(user.timeZone),
    hasHealthConnectRecords(user.id),
  ]);
  const logs = await listUpdates(
    user.id,
    phones.map((p) => p.id),
    RECENT_UPDATES,
  );
  const today = localParts(new Date(), zone).date;
  /** ["Today", "14:40"], ["Yesterday", "21:05"], ["Nov 9", "08:10"]. */
  const moment = (iso: string) => {
    const at = localParts(new Date(iso), zone);
    const yesterday = at.date === shiftLocalDate(today, -1);
    const day = at.date === today ? "Today" : yesterday ? "Yesterday" : shortDate(at.date);
    return { day, time: at.time, today: at.date === today, recent: at.date === today || yesterday };
  };
  const rows: PhoneRow[] = phones.map((phone) => {
    const log = logs.get(phone.id) ?? { updates: [], count: 0 };
    const linked = moment(phone.createdAt);
    const sent = phone.lastSyncAt ? moment(phone.lastSyncAt) : null;
    return {
      ...phone,
      linked: linked.recent
        ? `Linked ${linked.day.toLowerCase()} ${linked.time}`
        : `Linked ${linked.day}`,
      version: phone.appVersion?.replace(/\s*\(\d+\)$/, "") || null,
      lastSent: sent ? `${sent.day} ${sent.time}` : null,
      warning: sent !== null && !hasRecords,
      updateCount: log.count,
      updates: log.updates.map((u) => {
        const at = moment(u.receivedAt);
        return {
          id: u.id,
          when: at.recent ? `${at.day} ${at.time}` : `${at.day}, ${at.time}`,
          summary: updateSummary(u, at.today),
        };
      }),
    };
  });
  return <AndroidView release={release} phones={rows} kept={kept} appId={config.appId} />;
}
