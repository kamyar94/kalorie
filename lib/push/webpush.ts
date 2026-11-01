// Web Push without a library: message encryption (RFC 8291, "aes128gcm" content coding of
// RFC 8188) and VAPID (RFC 8292) with node:crypto. Requests go through the egress proxy like every
// other outbound call. Server only.
//
// Keys: VAPID_PUBLIC_KEY is the uncompressed P-256 point (65 bytes) and VAPID_PRIVATE_KEY the
// 32-byte private scalar, both base64url, as `node scripts/cal.mjs vapid` prints them.
import crypto from "node:crypto";

import { egressFetch } from "@/lib/net/egress";

export type VapidKeys = { publicKey: string; privateKey: string; subject: string };

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

const b64url = (buffer: Buffer | Uint8Array) => Buffer.from(buffer).toString("base64url");
const fromB64url = (text: string) => Buffer.from(text, "base64url");

/**
 * A P-256 private scalar as exactly 32 bytes. Node's ECDH.getPrivateKey() drops leading zero
 * bytes, so about one key in 256 comes out shorter; zeros on the left restore the same number.
 */
export const scalar32 = (scalar: Uint8Array) =>
  scalar.length >= 32
    ? Buffer.from(scalar)
    : Buffer.concat([Buffer.alloc(32 - scalar.length), Buffer.from(scalar)]);

/** A new VAPID key pair (base64url). */
export const generateVapidKeys = () => {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: b64url(ecdh.getPublicKey()),
    privateKey: b64url(scalar32(ecdh.getPrivateKey())),
  };
};

/**
 * The VAPID private key as a KeyObject (JWK built from the scalar and its public point). A scalar
 * shorter than 32 bytes (written by a key tool that dropped leading zeros) is padded.
 */
const vapidPrivateKey = (keys: Pick<VapidKeys, "publicKey" | "privateKey">) => {
  const pub = fromB64url(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC_KEY is not a P-256 point.");
  const raw = fromB64url(keys.privateKey);
  if (raw.length < 16 || raw.length > 32)
    throw new Error("VAPID_PRIVATE_KEY is not a P-256 private key.");
  const d = scalar32(raw);
  return crypto.createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: b64url(pub.subarray(1, 33)),
      y: b64url(pub.subarray(33, 65)),
      d: b64url(d),
    },
    format: "jwk",
  });
};

/** Checks that the keys belong together (signs and verifies once). */
export const vapidKeysValid = (keys: Pick<VapidKeys, "publicKey" | "privateKey">) => {
  try {
    const key = vapidPrivateKey(keys);
    const data = Buffer.from("cal");
    const signature = crypto.sign("sha256", data, { key, dsaEncoding: "ieee-p1363" });
    const pub = fromB64url(keys.publicKey);
    const publicKey = crypto.createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: b64url(pub.subarray(1, 33)),
        y: b64url(pub.subarray(33, 65)),
      },
      format: "jwk",
    });
    return crypto.verify("sha256", data, { key: publicKey, dsaEncoding: "ieee-p1363" }, signature);
  } catch {
    return false;
  }
};

/** "vapid t=<JWT>, k=<public key>" for one push service origin, valid for 12 hours. */
export const vapidAuthorization = (endpoint: string, keys: VapidKeys, now = Date.now()) => {
  const audience = new URL(endpoint).origin;
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject }),
    ),
  );
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${claims}`), {
    key: vapidPrivateKey(keys),
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
};

const RECORD_SIZE = 4096;

/**
 * Encrypts a payload for one subscription (RFC 8291): an ephemeral ECDH key with the browser's
 * p256dh key and its auth secret give the content key and nonce; one record, padding delimiter 2.
 */
export const encryptPayload = (
  payload: Buffer,
  target: Pick<PushTarget, "p256dh" | "auth">,
  random: { salt?: Buffer; ecdh?: crypto.ECDH } = {},
) => {
  const uaPublic = fromB64url(target.p256dh);
  const authSecret = fromB64url(target.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("Bad p256dh key.");
  if (authSecret.length !== 16) throw new Error("Bad auth secret.");
  if (payload.length > RECORD_SIZE - 17 - 86) throw new Error("Payload too large.");
  const ecdh = random.ecdh ?? crypto.createECDH("prime256v1");
  if (!random.ecdh) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", sharedSecret, authSecret, keyInfo, 32));
  const salt = random.salt ?? crypto.randomBytes(16);
  const cek = Buffer.from(
    crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
  );
  const nonce = Buffer.from(
    crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12),
  );
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
};

export type PushSendResult = {
  status: number;
  /** The subscription is gone (404, 410): remove it. */
  expired: boolean;
  /** Worth trying again later (network, 429, 5xx). */
  retry: boolean;
};

/** Sends one encrypted message. Never throws for network problems. */
export const sendPush = async (
  target: PushTarget,
  payload: unknown,
  keys: VapidKeys,
  options: { ttlSeconds?: number; urgency?: "low" | "normal" | "high"; topic?: string } = {},
): Promise<PushSendResult> => {
  const body = encryptPayload(Buffer.from(JSON.stringify(payload)), target);
  try {
    const response = await egressFetch(target.endpoint, {
      method: "POST",
      headers: {
        authorization: vapidAuthorization(target.endpoint, keys),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(options.ttlSeconds ?? 86_400),
        urgency: options.urgency ?? "normal",
        ...(options.topic
          ? { topic: options.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) }
          : {}),
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel().catch(() => undefined);
    const status = response.status;
    return {
      status,
      expired: status === 404 || status === 410,
      retry: status === 429 || status >= 500,
    };
  } catch {
    return { status: 0, expired: false, retry: true };
  }
};
