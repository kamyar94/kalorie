// POST /api/meals/:id/answers {questionId, answer} -> 202 MealDto (queued for a new analysis):
// stores the answer on the meal and queues an analysis that uses it (lib/analysis/requests.ts).
// 400 bad input, 401 signed out, 403 cross-site, 404 not the person's meal or question,
// 409 no photos, 429 too many requests.
import type { NextRequest } from "next/server";

import { badBody, readJsonBody, resultResponse } from "@/lib/analysis/http";
import { answerQuestion } from "@/lib/analysis/requests";
import { apiUser } from "@/lib/http/route";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonBody(req);
  if (!body || typeof body.questionId !== "string" || typeof body.answer !== "string")
    return badBody();
  return resultResponse(
    await answerQuestion(user.id, (await params).id, body.questionId.slice(0, 64), body.answer),
  );
};
