// POST /api/suggestions/idea { tz } -> { idea: MealIdeaDto }: "Something new (asks your AI)", one
// meal idea for now from the person's own AI provider (lib/suggest/idea.ts). Nothing is saved.
// 422 when today's energy is already reached; 409 when the fix is in the AI settings (no key, a
// refused key, no credit); the other AI errors in the words of the AI settings page.
import type { NextRequest } from "next/server";

import { describeAiError, isAiError, needsAiSettings } from "@/lib/ai/errors";
import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { suggestIdea } from "@/lib/suggest/idea";
import { requestZone } from "@/lib/suggest/zone";

export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = { "local-rate-limit": 429, "rate-limit": 429 };

export const POST = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = (await readJsonObject(req)) ?? {};
  const tz = requestZone(req, body.tz, user.timeZone);
  try {
    const idea = await suggestIdea(user.id, { now: new Date(), tz });
    if (idea === "nothing-left")
      return errorJson(422, "Today's energy target is reached, so there is nothing to suggest.");
    return json({ idea }, { headers: { "cache-control": "no-store" } });
  } catch (caught) {
    if (isAiError(caught))
      return errorJson(
        needsAiSettings(caught) ? 409 : (STATUS[caught.kind] ?? 502),
        describeAiError(caught),
      );
    return errorJson(502, "The AI's answer could not be used. Try again.");
  }
};
