// Shared parts of the analysis routes (POST /api/meals/:id/answers, /corrections, /retry): the
// signed-in user with the same-origin check, a small JSON body, and the answer for a result.
import type { NextRequest } from "next/server";

import type { AnalysisRequestResult } from "@/lib/contracts/analysis";
import { errorJson, json } from "@/lib/http/route";

const MAX_BODY_BYTES = 4096;

/** The JSON object of a request body, {} for an empty body, or null when it is not valid. */
export const readJsonBody = async (req: NextRequest): Promise<Record<string, unknown> | null> => {
  const text = await req.text().catch(() => null);
  if (text === null || text.length > MAX_BODY_BYTES) return null;
  if (!text.trim()) return {};
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

export const resultResponse = (result: AnalysisRequestResult) =>
  result.ok
    ? json(result.meal, { status: 202, headers: { "cache-control": "no-store" } })
    : errorJson(result.status, result.error);

export const badBody = () => errorJson(400, "The request body is not valid.");
