// POST /api/meals/:id/corrections {text, replaceEdits?} -> 202 MealDto (queued for a new
// analysis): "fix with a sentence". The text is kept with the meal and sent with every later
// analysis; items edited by hand stay unless replaceEdits is true. Errors as in the answers route.
import type { NextRequest } from "next/server";

import { badBody, readJsonBody, resultResponse } from "@/lib/analysis/http";
import { correctMeal } from "@/lib/analysis/requests";
import { apiUser } from "@/lib/http/route";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonBody(req);
  if (
    !body ||
    typeof body.text !== "string" ||
    (body.replaceEdits !== undefined && typeof body.replaceEdits !== "boolean")
  )
    return badBody();
  return resultResponse(
    await correctMeal(user.id, (await params).id, body.text, {
      replaceEdits: body.replaceEdits === true,
    }),
  );
};
