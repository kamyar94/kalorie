// POST /api/meals/:id/retry {replaceEdits?} -> 202 MealDto (queued for a new analysis), for a
// failed meal or to analyse it again. Errors as in the answer route.
import type { NextRequest } from "next/server";

import { badBody, readJsonBody, resultResponse } from "@/lib/analysis/http";
import { retryAnalysis } from "@/lib/analysis/requests";
import { apiUser } from "@/lib/http/route";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonBody(req);
  if (!body || (body.replaceEdits !== undefined && typeof body.replaceEdits !== "boolean"))
    return badBody();
  return resultResponse(
    await retryAnalysis(user.id, (await params).id, { replaceEdits: body.replaceEdits === true }),
  );
};
