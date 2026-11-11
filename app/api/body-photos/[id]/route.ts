// DELETE /api/body-photos/:id -> {ok}: removes one body photo and its files (and the day's session
// when it was the last). Another person's photo answers 404.
import type { NextRequest } from "next/server";

import { deleteBodyPhoto } from "@/lib/body/photos";
import { apiUser, errorJson, json } from "@/lib/http/route";

export const dynamic = "force-dynamic";

export const DELETE = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  if (!(await deleteBodyPhoto(user.id, (await params).id))) return errorJson(404, "Not found.");
  return json({ ok: true });
};
