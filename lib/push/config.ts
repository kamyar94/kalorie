// Web Push settings from the server's environment (docs/DESIGN.md section 9). Without valid VAPID
// keys notifications are off and Settings says so.
//
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   base64url (node scripts/cal.mjs vapid makes a pair)
//   VAPID_SUBJECT                         mailto:admin@example.org or an https URL
//   PUSH_SERVICE_HOSTS                    extra push service host names (comma separated)
//   PUSH_ENDPOINT_ORIGINS                 exact origins allowed even over http (tests only)
//
// Subscriptions come from browsers, so their endpoint is checked before Cal ever sends to it: https
// on a known push service (Google FCM for Chrome and Android, Mozilla for Firefox, Apple for
// Safari and iOS, Microsoft WNS for Edge on Windows). The egress proxy allows the same hosts.
import { vapidKeysValid, type VapidKeys } from "./webpush";

export type Env = Record<string, string | undefined>;

export const DEFAULT_PUSH_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];

let checked: { key: string; valid: boolean } | null = null;

/** The VAPID keys, or null when they are missing or do not belong together. */
export const vapidConfig = (env: Env = process.env): VapidKeys | null => {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(subject)) return null;
  const key = `${publicKey}:${privateKey}`;
  if (checked?.key !== key) checked = { key, valid: vapidKeysValid({ publicKey, privateKey }) };
  return checked.valid ? { publicKey, privateKey, subject } : null;
};

export const pushConfigured = (env: Env = process.env) => vapidConfig(env) !== null;

/** Whether Cal may send to this endpoint. */
export const allowedEndpoint = (endpoint: string, env: Env = process.env) => {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.username || url.password || endpoint.length > 1024) return false;
  const origins = (env.PUSH_ENDPOINT_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.includes(url.origin)) return true;
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) return false;
  const hosts = [
    ...DEFAULT_PUSH_HOSTS,
    ...(env.PUSH_SERVICE_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  ];
  const host = url.hostname.toLowerCase();
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
};
