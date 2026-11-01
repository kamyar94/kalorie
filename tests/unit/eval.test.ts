// The accuracy script against the provider mock (never a real provider): folder format, the
// numbers it reports, and that the key stays out of the output.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadEvalFolder, main, summarise, type EvalMealResult } from "@/lib/analysis/eval";
import { DRINK, GOOD_MEAL, imagesOf, promptOf } from "@/tests/fixtures/analysis";
import {
  aiReplies,
  startAiMock,
  TEST_API_KEY,
  useAiMock,
  type AiMock,
} from "@/tests/helpers/ai-mock";

let ai: AiMock;
let restore: () => void;
let dir: string;

const meal = async (name: string, truth: unknown, photos = 1) => {
  const folder = path.join(dir, name);
  mkdirSync(folder, { recursive: true });
  for (let i = 0; i < photos; i += 1)
    writeFileSync(
      path.join(folder, `${i + 1}.jpg`),
      await sharp({ create: { width: 2400, height: 1800, channels: 3, background: "#b07030" } })
        .jpeg()
        .toBuffer(),
    );
  if (truth !== undefined) writeFileSync(path.join(folder, "truth.json"), JSON.stringify(truth));
};

beforeAll(async () => {
  ai = await startAiMock();
  restore = useAiMock(ai);
  dir = mkdtempSync(path.join(os.tmpdir(), "cal-eval-"));
  await meal(
    "a-plate",
    { kcal: 700, protein: 60, carbs: 80, fat: 15, note: "ate it all", time: "13:10" },
    2,
  );
  await meal("b-juice", { kcal: 140, grams: 300 });
  await meal("c-no-truth", undefined);
  mkdirSync(path.join(dir, "d-no-photos"));
  writeFileSync(path.join(dir, "d-no-photos", "truth.json"), JSON.stringify({ kcal: 100 }));
});

afterAll(async () => {
  restore();
  await ai.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("eval script", () => {
  it("reads the folder format and skips incomplete meals", async () => {
    const skipped: string[] = [];
    const meals = await loadEvalFolder(dir, (line) => skipped.push(line));
    expect(meals.map((m) => [m.name, m.photos.length])).toEqual([
      ["a-plate", 2],
      ["b-juice", 1],
    ]);
    expect(skipped).toHaveLength(2);
  });

  it("reports error, bias and latency per provider and model, without the key", async () => {
    ai.reset();
    ai.queue("google", aiReplies.google.json(GOOD_MEAL), aiReplies.google.json(DRINK));
    const lines: string[] = [];
    const json = path.join(dir, "results.json");
    const code = await main(
      ["--dir", dir, "--provider", "google", "--model", "gemini-3.8-flash", "--json", json],
      { CAL_EVAL_API_KEY: TEST_API_KEY },
      (line) => lines.push(line),
    );
    expect(code).toBe(0);
    const output = lines.join("\n");
    expect(output).not.toContain(TEST_API_KEY);
    expect(output).toContain("google gemini-3.8-flash (effort low)");
    expect(output).toContain("The model's own estimates:");

    // The worker's prompt and photo size: two photos, resized to the 1280 px analysis copy.
    expect(imagesOf("google", ai.requests[0]!)).toBe(2);
    expect(promptOf("google", ai.requests[0]!)).toContain('"ate it all"');
    const body = ai.requests[0]!.body as {
      contents: { parts: { inlineData?: { data: string } }[] }[];
    };
    const image = Buffer.from(body.contents[0]!.parts[1]!.inlineData!.data, "base64");
    expect((await sharp(image).metadata()).width).toBe(1280);

    const saved = JSON.parse(readFileSync(json, "utf8")) as {
      summary: ReturnType<typeof summarise>;
      results: EvalMealResult[];
    };
    // Estimates: the plate 330 + 300 + 18 + 65 = 713 kcal (true 700), the juice 135 (true 140).
    expect(saved.results.map((r) => r.model?.kcal)).toEqual([713, 135]);
    expect(saved.summary.model.kcal).toEqual({
      n: 2,
      mae: 9,
      mape: 2.7,
      bias: 4,
      biasPercent: -0.9,
    });
    expect(saved.summary.model.grams).toMatchObject({ n: 1, mae: 10 });
    expect(saved.summary.latency.p90).toBeGreaterThanOrEqual(0);
    expect(saved.summary.tokens.inputTokens).toBe(240);
  });

  it("reports failed meals and refuses to run without a key", async () => {
    ai.reset();
    ai.queue("openai", aiReplies.openai.badKey, aiReplies.openai.json(DRINK));
    const lines: string[] = [];
    const code = await main(
      ["--dir", dir, "--provider", "openai", "--key-env", "MY_KEY"],
      { MY_KEY: TEST_API_KEY },
      (line) => lines.push(line),
    );
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("failed: auth:");
    expect(lines.join("\n")).not.toContain(TEST_API_KEY);
    expect(lines.join("\n")).toContain("Meals: 2, failed: 1.");

    const missing: string[] = [];
    expect(
      await main(["--dir", dir, "--provider", "openai"], {}, (line) => missing.push(line)),
    ).toBe(2);
    expect(missing.join("\n")).toContain("CAL_EVAL_API_KEY");
    expect(await main(["--dir", dir, "--provider", "nobody"], {}, () => undefined)).toBe(2);
  });
});
