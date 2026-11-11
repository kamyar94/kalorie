// GET /api/medicine-scans/:id/:size (thumb | original): the label photo's bytes, only for the
// person who took it. Anyone else gets the same 404 as for an id that does not exist.
import type { NextRequest } from "next/server";

import { apiUser, errorJson } from "@/lib/http/route";
import { scanPhotoPath } from "@/lib/medicines/scans";
import { readPhotoFile } from "@/lib/photos/storage";

export const dynamic = "force-dynamic";

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string; size: string }> },
) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const { id, size } = await params;
  if (size !== "thumb" && size !== "original") return errorJson(404, "Not found.");
  const path = await scanPhotoPath(user.id, id, size);
  const bytes = path ? await readPhotoFile(path) : null;
  if (!bytes) return errorJson(404, "Not found.");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "image/jpeg",
      "content-length": String(bytes.length),
      // Photos never change for an id. "private" keeps shared caches out.
      "cache-control": "private, max-age=31536000, immutable",
      "content-disposition": "inline",
    },
  });
};
