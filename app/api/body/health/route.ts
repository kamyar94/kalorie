// PUT /api/body/health { conditions?, allergies?, notes?, useInAnalysis?, heightCm?, birthYear?,
//       goal?, goalRateKgPerWeek? } -> HealthProfileDto
// The signed-in person's private health profile. Nothing in it is logged.
import type { NextRequest } from "next/server";

import { SettingsInputError } from "@/lib/account/settings";
import { saveHealthProfile } from "@/lib/body/health";
import { parseHealthText } from "@/lib/body/parse";
import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";

export const dynamic = "force-dynamic";

export const PUT = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonObject(req, 32 * 1024);
  if (!body) return errorJson(400, "Send the health profile as JSON.");
  try {
    const saved = await saveHealthProfile(user.id, {
      ...parseHealthText(body),
      ...("heightCm" in body ? { heightCm: body.heightCm } : {}),
      ...("birthYear" in body ? { birthYear: body.birthYear } : {}),
      ...("goal" in body ? { goal: body.goal } : {}),
      ...("goalRateKgPerWeek" in body ? { goalRateKgPerWeek: body.goalRateKgPerWeek } : {}),
    });
    if (!saved) return errorJson(404, "Not found.");
    return json(saved, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof SettingsInputError) return errorJson(400, err.message);
    throw err;
  }
};
