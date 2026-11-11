// CONTRACT: phones linked through the Kal Android app. The app is the Kal site in a Trusted Web
// Activity plus a small native part that reads Health Connect and sends the records here. Plain
// data, safe for client components.
//
// Linking: on the "Kal for Android" page inside the app, "Connect Health Connect" asks for a
// one-time code (valid DEVICE_LIMITS.codeMinutes) and opens the native screen with it through an
// intent URL. The native side trades the code over HTTPS for a long-lived device token, which it
// keeps in the Android Keystore. The token never appears in a URL; the database keeps only its
// SHA-256. Unlinking (here or on the phone) revokes the token: the phone's next call gets a 401.
//
// Server functions (lib/devices/service.ts), each scoped by user id:
//   createLinkCode(userId)                    -> { code, expiresAt }
//   claimLinkCode(code, { name, appVersion })   -> { token, device } | "invalid" | "too-many"
//   deviceForToken(token)                       -> the device and its owner, or null
//   listDevices(userId)                         -> DeviceDto[]   linked phones, newest first
//   revokeDevice(userId, id)                    -> boolean
// HTTP: POST /api/devices/link-codes, POST /api/devices/claim, GET /api/devices,
// DELETE /api/devices/:id, GET and DELETE /api/devices/self (device token).

/** What a phone sends, as the "Your phones" list names it. */
export const SEND_KINDS = ["steps", "workouts", "heart_rate", "sleep", "weight", "body"] as const;
export type SendKind = (typeof SEND_KINDS)[number];

export const SEND_LABELS: Record<SendKind, string> = {
  steps: "steps",
  workouts: "workouts",
  heart_rate: "heart rate",
  sleep: "sleep",
  weight: "weight",
  body: "body composition",
};

export const isSendKind = (value: unknown): value is SendKind =>
  typeof value === "string" && (SEND_KINDS as readonly string[]).includes(value);

export const DEVICE_LIMITS = {
  /** How long a one-time link code is valid. */
  codeMinutes: 10,
  nameChars: 80,
  /** Linked phones per account at a time. */
  maxDevices: 10,
} as const;

export type DeviceDto = {
  id: string;
  /** Manufacturer and model as the phone reports them ("Samsung SM-S928B"). */
  name: string;
  /** "1.0 (1)" when the app said. */
  appVersion: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  /** What it has sent so far, in SEND_KINDS order. */
  sends: SendKind[];
};

export type LinkCodeDto = {
  code: string;
  expiresAt: string;
  /** Opens the app's native Health Connect screen with the code. */
  intentUrl: string;
};

/** The intent URL that opens the native screen of the app `appId` with a one-time code. */
export const linkIntentUrl = (code: string, appId: string) =>
  `intent://link?code=${encodeURIComponent(code)}#Intent;scheme=kal;package=${appId};end`;

/** "steps, workouts, heart rate" for a device's list line. */
export const sendsLine = (sends: SendKind[]) =>
  SEND_KINDS.filter((k) => sends.includes(k))
    .map((k) => SEND_LABELS[k])
    .join(", ");
