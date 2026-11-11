// DELETE /api/devices/:id -> {ok}: unlinks one of the person's phones ("Unlink" on Kal for
// Android). Its token stops working at once; the phone shows "Unlinked. Link again." on its next
// call. Another person's phone answers 404.
import type { NextRequest } from "next/server";

import { revokeDevice } from "@/lib/devices/service";
import { apiUser, errorJson, json } from "@/lib/http/route";

export const dynamic = "force-dynamic";

export const DELETE = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  if (!(await revokeDevice(user.id, (await params).id))) return errorJson(404, "Not found.");
  return json({ ok: true });
};
