// Adapted from the Lingo project's key encryption tests.
import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  aiKeyContext,
  decryptSecret,
  encryptSecret,
  hasSecretKey,
  integrationContext,
  lastFour,
  loadSecretKey,
  SecretKeyError,
} from "./crypto";

const key = crypto.randomBytes(32);
const context = aiKeyContext("user-1", "openai");
const secret = "sk-test-0123456789abcdefWXYZ";

// Changes one byte of one dot-separated part, keeping it valid base64url.
const flip = (token: string, part: number) => {
  const parts = token.split(".");
  const bytes = Buffer.from(parts[part]!, "base64url");
  bytes[0]! ^= 0x01;
  parts[part] = bytes.toString("base64url");
  return parts.join(".");
};

describe("secret encryption", () => {
  it("round-trips a key", () => {
    const token = encryptSecret(secret, context, key);
    expect(token.startsWith("v1.")).toBe(true);
    expect(token).not.toContain(secret);
    expect(decryptSecret(token, context, key)).toBe(secret);
  });

  it("round-trips unicode and long values", () => {
    const value = `${"k".repeat(500)}-کلید-鍵`;
    expect(decryptSecret(encryptSecret(value, context, key), context, key)).toBe(value);
  });

  it("uses a fresh IV every time", () => {
    const a = encryptSecret(secret, context, key);
    const b = encryptSecret(secret, context, key);
    expect(a).not.toBe(b);
    expect(a.split(".")[1]).not.toBe(b.split(".")[1]);
  });

  it("detects a changed ciphertext, tag or IV", () => {
    const token = encryptSecret(secret, context, key);
    for (const part of [1, 2, 3])
      expect(() => decryptSecret(flip(token, part), context, key)).toThrow(
        /changed or belongs elsewhere/,
      );
  });

  it("refuses a value copied to another account, provider or purpose", () => {
    const token = encryptSecret(secret, context, key);
    expect(() => decryptSecret(token, aiKeyContext("user-2", "openai"), key)).toThrow();
    expect(() => decryptSecret(token, aiKeyContext("user-1", "anthropic"), key)).toThrow();
    expect(() => decryptSecret(token, integrationContext("user-1", "openai"), key)).toThrow();
  });

  it("refuses a different server key and malformed values", () => {
    const token = encryptSecret(secret, context, key);
    expect(() => decryptSecret(token, context, crypto.randomBytes(32))).toThrow();
    expect(() => decryptSecret("plain-text", context, key)).toThrow(/Unknown format/);
    expect(() => decryptSecret("v2.a.b.c", context, key)).toThrow(/Unknown format/);
    expect(() => decryptSecret("v1.AAAA.BBBB.CCCC", context, key)).toThrow(/Unknown format/);
  });
});

describe("CAL_SECRET_KEY", () => {
  it("accepts the base64 of 32 bytes", () => {
    const value = crypto.randomBytes(32).toString("base64");
    expect(loadSecretKey({ CAL_SECRET_KEY: value })).toHaveLength(32);
    expect(hasSecretKey({ CAL_SECRET_KEY: value })).toBe(true);
  });

  it("explains a missing or wrong key without echoing it", () => {
    expect(() => loadSecretKey({})).toThrow(SecretKeyError);
    expect(hasSecretKey({})).toBe(false);
    const short = crypto.randomBytes(16).toString("base64");
    let message = "";
    try {
      loadSecretKey({ CAL_SECRET_KEY: short });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/exactly 32/);
    expect(message).not.toContain(short);
    expect(hasSecretKey({ CAL_SECRET_KEY: "not base64 at all!" })).toBe(false);
  });

  it("shows only the last four characters of a key", () => {
    expect(lastFour(` ${secret} `)).toBe("WXYZ");
  });
});
