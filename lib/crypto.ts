// Encryption of per-user secrets (AI keys, Mealie and openGym credentials) before they reach the
// database: AES-256-GCM with the server key CAL_SECRET_KEY (base64 of 32 random bytes, kept in a
// secrets file on the server, never in the repository). Each ciphertext is bound to its account
// and purpose through the GCM additional data, so a stored value copied to another row no longer
// decrypts. A changed byte anywhere makes decryption fail instead of returning garbage.
// Adapted from the Lingo project.
//
// Make a key with:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
import crypto from "node:crypto";

export type Env = Record<string, string | undefined>;

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretKeyError";
  }
}

/** The server key from CAL_SECRET_KEY. Throws SecretKeyError when missing or malformed. */
export const loadSecretKey = (env: Env = process.env) => {
  const value = env.CAL_SECRET_KEY?.trim();
  if (!value) throw new SecretKeyError("CAL_SECRET_KEY is not set on the server.");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value.replace(/\s/g, ""))
    throw new SecretKeyError("CAL_SECRET_KEY must be the base64 of exactly 32 random bytes.");
  return key;
};

export const hasSecretKey = (env: Env = process.env) => {
  try {
    loadSecretKey(env);
    return true;
  } catch {
    return false;
  }
};

/** Additional data for an AI key: one account, one provider. */
export const aiKeyContext = (userId: string, provider: string) =>
  `cal-ai-key:${userId}:${provider}`;

/** Additional data for an integration credential: one account, one integration kind. */
export const integrationContext = (userId: string, kind: string) =>
  `cal-integration:${userId}:${kind}`;

/** Encrypts text into "v1.<iv>.<tag>.<ciphertext>", each part base64url. */
export const encryptSecret = (plain: string, context: string, key: Buffer = loadSecretKey()) => {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, ...[iv, tag, ciphertext].map((part) => part.toString("base64url"))].join(".");
};

/** Decrypts a value made by encryptSecret. Throws when it was changed, or the context differs. */
export const decryptSecret = (token: string, context: string, key: Buffer = loadSecretKey()) => {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION)
    throw new Error("Unknown format of an encrypted value.");
  const [iv, tag, ciphertext] = parts.slice(1).map((part) => Buffer.from(part, "base64url")) as [
    Buffer,
    Buffer,
    Buffer,
  ];
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES)
    throw new Error("Unknown format of an encrypted value.");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("The encrypted value was changed or belongs elsewhere.");
  }
};

/** The last four characters, the only part of a key the browser ever sees again. */
export const lastFour = (secret: string) => secret.trim().slice(-4);

export const sha256Hex = (value: string | Buffer) =>
  crypto.createHash("sha256").update(value).digest("hex");
