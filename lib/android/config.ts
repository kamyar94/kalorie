// The Kal Android app as this server knows it, all from the environment (site.env on the server):
//   ANDROID_APP_ID        the app's package name; the linking intent opens this package
//   ANDROID_CERT_SHA256   SHA-256 fingerprints of the signing certificates, comma separated
//                         ("AB:CD:..." as apksigner and keytool print them)
//   ANDROID_APK_DIR       the folder with kal.apk and version.json (mounted read-only)
// Nothing here is secret, but none of it belongs in the repository either: each server has its
// own address, app id and signing key.

type Env = Record<string, string | undefined>;

const APP_ID = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

/** The package name when it is a valid one (letters, digits, underscores, at least one dot). */
export const parseAppId = (value: string | undefined) => {
  const id = value?.trim() ?? "";
  return id.length <= 150 && APP_ID.test(id) ? id : null;
};

/**
 * The certificate fingerprints, written the way Digital Asset Links wants them: 32 bytes as
 * upper-case hex pairs joined by colons. Values with or without colons are accepted; anything
 * else is left out.
 */
export const parseFingerprints = (value: string | undefined) => [
  ...new Set(
    (value ?? "")
      .split(",")
      .map((part) => part.trim().replace(/:/g, "").toUpperCase())
      .filter((hex) => /^[0-9A-F]{64}$/.test(hex))
      .map((hex) => hex.match(/../g)!.join(":")),
  ),
];

export type AndroidConfig = {
  appId: string | null;
  fingerprints: string[];
  apkDir: string | null;
};

export const androidConfig = (env: Env = process.env): AndroidConfig => ({
  appId: parseAppId(env.ANDROID_APP_ID),
  fingerprints: parseFingerprints(env.ANDROID_CERT_SHA256),
  apkDir: env.ANDROID_APK_DIR?.trim() || null,
});

/**
 * /.well-known/assetlinks.json: lets the app open this site full screen (Trusted Web Activity)
 * and handle its links. Null (a 404) until both the app id and a fingerprint are set.
 */
export const assetLinks = (config: AndroidConfig = androidConfig()) =>
  config.appId && config.fingerprints.length
    ? [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: {
            namespace: "android_app",
            package_name: config.appId,
            sha256_cert_fingerprints: config.fingerprints,
          },
        },
      ]
    : null;
