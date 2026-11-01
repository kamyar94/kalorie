import { describe, expect, it } from "vitest";

import {
  describeAiError,
  isRetryableAiError,
  needsAiSettings,
  AiError,
  cleanProviderMessage,
} from "@/lib/ai/errors";
import { hashCode, newCode, normalizeCode } from "@/lib/auth/codes";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { backoffMs } from "@/lib/queue/queue";
import * as tool from "@/scripts/cal.mjs";

describe("passwords", () => {
  it("hashes with scrypt and verifies only the right password", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterY", stored)).toBe(false);
    expect(await verifyPassword("x", "plain")).toBe(false);
    expect(passwordProblem("short")).toMatch(/at least 10/);
    expect(passwordProblem("long enough pass")).toBeNull();
  });
});

describe("invite and reset codes", () => {
  it("are 16 characters without look-alikes, typed in any case and grouping", () => {
    const code = newCode();
    expect(code.plain).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
    expect(hashCode(code.plain.toLowerCase().replace(/-/g, " "))).toBe(code.hash);
    expect(normalizeCode("ab-cd ef")).toBe("ABCDEF");
  });

  it("hash the same way in the server tool", () => {
    const code = tool.newCode();
    expect(hashCode(code.plain)).toBe(code.hash);
    expect(tool.hashCode("abcd-efgh")).toBe(hashCode("ABCDEFGH"));
  });
});

describe("job backoff", () => {
  it("doubles from 15 seconds up to 30 minutes, with jitter", () => {
    const mid = () => 0.5;
    expect(backoffMs(1, mid)).toBe(15_000);
    expect(backoffMs(2, mid)).toBe(30_000);
    expect(backoffMs(4, mid)).toBe(120_000);
    expect(backoffMs(20, mid)).toBe(30 * 60_000);
    expect(backoffMs(1, () => 0)).toBe(13_500);
    expect(backoffMs(1, () => 1)).toBe(16_500);
  });
});

describe("AI errors", () => {
  it("say which failures are worth retrying and which need the settings", () => {
    expect(isRetryableAiError(new AiError("overloaded", ""))).toBe(true);
    expect(isRetryableAiError(new AiError("auth", ""))).toBe(false);
    expect(needsAiSettings(new AiError("no-key", ""))).toBe(true);
    expect(needsAiSettings(new Error("x"))).toBe(false);
    expect(describeAiError(new AiError("no-key", ""))).toMatch(/AI settings/);
  });

  it("remove keys from provider messages", () => {
    const key = "sk-test-SECRET-0123456789";
    const text = cleanProviderMessage(
      `Bad key ${key} and AIzaSyD0123456789abcdef and Bearer abc.def`,
      key,
    );
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("AIza");
    expect(text).not.toContain("abc.def");
    expect(cleanProviderMessage("x".repeat(500)).length).toBe(300);
  });
});
