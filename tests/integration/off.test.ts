// Open Food Facts barcode lookups against a mock API that replays recorded replies.
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createCustomFood } from "@/lib/food/custom-foods";
import { clearOffMissing, lookupBarcode, offConfig } from "@/lib/food/off";
import { searchFoods } from "@/lib/food/search";

import { createUser } from "../helpers/factories";
import { startMockServer, type MockServer } from "../helpers/mock-http";

const recorded = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dirname, "../fixtures/off/product-3017620422003.json"),
    "utf8",
  ),
);
const NUTELLA = "3017620422003";

/** A valid EAN-13 from 12 digits. */
const ean13 = (twelve: string) => {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(twelve[i]) * (i % 2 === 0 ? 1 : 3);
  return `${twelve}${(10 - (sum % 10)) % 10}`;
};

let mock: MockServer;
let config: ReturnType<typeof offConfig>;

beforeAll(async () => {
  mock = await startMockServer();
  config = offConfig({ OFF_BASE_URL: mock.url, OFF_CONTACT: "admin@example.org" });
});
afterAll(async () => {
  await mock.close();
});
beforeEach(() => {
  mock.requests.length = 0;
  clearOffMissing();
  mock.reply((request) =>
    request.url.startsWith(`/api/v2/product/${NUTELLA}`)
      ? { json: recorded }
      : { status: 404, json: { status: 0, status_verbose: "product not found" } },
  );
});

describe("Open Food Facts lookup", () => {
  it("fetches a product, saves it with attribution and serves it from the cache", async () => {
    const user = await createUser();
    const found = await lookupBarcode(user.id, NUTELLA, { config });
    expect(found.status).toBe("found");
    expect(found.food).toMatchObject({
      source: "off",
      kind: "packaged",
      nameEn: "Nutella",
      brand: "Nutella",
      barcode: NUTELLA,
      personal: false,
    });
    expect(found.food!.per100g).toMatchObject({ energy: 539, fat: 30.9, sodium: 42.8 });
    expect(found.food!.sourceNote).toMatch(/Open Food Facts.*ODbL/);
    expect(found.food!.portions).toEqual([
      expect.objectContaining({ label: "1 package (400 g e)", grams: 400 }),
    ]);

    expect(mock.requests).toHaveLength(1);
    const request = mock.requests[0]!;
    expect(request.url).toMatch(new RegExp(`^/api/v2/product/${NUTELLA}\\?fields=code,`));
    expect(request.headers["user-agent"]).toBe("Cal/0.1 (self-hosted food log; admin@example.org)");

    // Cached: no second request, and the product is found by search too.
    const again = await lookupBarcode(user.id, NUTELLA, { config });
    expect(again).toMatchObject({ status: "found", fresh: true });
    expect(again.food!.id).toBe(found.food!.id);
    expect(mock.requests).toHaveLength(1);
    expect((await searchFoods({ query: "nutella", userId: user.id }))[0]!.id).toBe(found.food!.id);
  });

  it("refreshes old entries and serves them stale when the API fails", async () => {
    const user = await createUser();
    await lookupBarcode(user.id, NUTELLA, { config });
    const later = new Date(Date.now() + 31 * 86_400_000);
    mock.reply(() => ({ status: 503, text: "busy" }));
    const before = mock.requests.length; // the product may be cached by an earlier test
    const stale = await lookupBarcode(user.id, NUTELLA, { config, now: later });
    expect(stale).toMatchObject({ status: "found", fresh: false });
    expect(mock.requests.length).toBe(before + 1);

    mock.reply(() => ({ json: recorded }));
    expect(await lookupBarcode(user.id, NUTELLA, { config, now: later })).toMatchObject({
      status: "found",
      fresh: true,
    });
  });

  it("remembers unknown codes for a day and refuses misread ones", async () => {
    const user = await createUser();
    const unknown = ean13("400638133393");
    expect(await lookupBarcode(user.id, unknown, { config })).toEqual({
      status: "not_found",
      food: null,
    });
    expect(await lookupBarcode(user.id, unknown, { config })).toEqual({
      status: "not_found",
      food: null,
    });
    expect(mock.requests).toHaveLength(1);

    expect(await lookupBarcode(user.id, "3017620422004", { config })).toEqual({
      status: "invalid",
      food: null,
    });
    expect(await lookupBarcode(user.id, "abc", { config })).toEqual({
      status: "invalid",
      food: null,
    });
    // Recorded live: an all-zero code answers status 0 with HTTP 200.
    const zeros = JSON.parse(
      readFileSync(
        path.resolve(import.meta.dirname, "../fixtures/off/product-not-found.json"),
        "utf8",
      ),
    );
    mock.reply(() => ({ json: zeros }));
    expect((await lookupBarcode(user.id, ean13("590000000000"), { config })).status).toBe(
      "not_found",
    );
    expect(mock.requests).toHaveLength(2);
  });

  it("says unavailable when the API cannot be reached and nothing is cached", async () => {
    const user = await createUser();
    const down = offConfig({ OFF_BASE_URL: "http://127.0.0.1:9" });
    expect(await lookupBarcode(user.id, ean13("761234567890"), { config: down })).toEqual({
      status: "unavailable",
      food: null,
    });
  });

  it("prefers the person's own food with that barcode", async () => {
    const user = await createUser();
    const own = await createCustomFood(user.id, {
      nameEn: "Hazelnut spread (my label)",
      barcode: NUTELLA,
      per100g: { energy: 530 },
    });
    const found = await lookupBarcode(user.id, NUTELLA, { config });
    expect(found.food).toMatchObject({ id: own.id, personal: true });
    expect(mock.requests).toHaveLength(0);
  });

  it("limits lookups per person", async () => {
    const user = await createUser();
    const statuses: string[] = [];
    for (let i = 0; i < 16; i++)
      statuses.push(
        (await lookupBarcode(user.id, ean13(`80000000${String(i).padStart(4, "0")}`), { config }))
          .status,
      );
    expect(statuses.slice(0, 15).every((s) => s === "not_found")).toBe(true);
    expect(statuses[15]).toBe("rate_limited");
  });
});
