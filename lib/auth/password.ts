// Password hashing with scrypt (adapted from the Lingo project). The stored form carries its own
// parameters, "scrypt$N$r$p$salt$hash", so they can be raised later without breaking old hashes.
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200;

export const hashPassword = async (password: string) => {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
};

export const verifyPassword = async (password: string, stored: string) => {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const N = Number(n);
  if (!Number.isInteger(N) || N < 1024 || N > 1_048_576) return false;

  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length, {
    N,
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

// Spends the same time as a real check when the username does not exist, so response time does
// not reveal which usernames are taken.
let dummyHash: Promise<string> | null = null;
export const burnPasswordCheck = async (password: string) => {
  dummyHash ??= hashPassword(crypto.randomBytes(16).toString("hex"));
  await verifyPassword(password, await dummyHash);
};

export const passwordProblem = (password: string) => {
  if (password.length < MIN_PASSWORD)
    return `Use a password of at least ${MIN_PASSWORD} characters.`;
  if (password.length > MAX_PASSWORD)
    return `Use a password of at most ${MAX_PASSWORD} characters.`;
  return null;
};
