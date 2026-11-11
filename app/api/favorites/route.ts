// GET /api/favorites?limit=6 -> { favorites: FavoriteDto[] }: the signed-in person's favorite
// meals, most recently used first (lib/meals/favorites.ts).
import type { NextRequest } from "next/server";

import { apiUser, json } from "@/lib/http/route";
import { listFavorites } from "@/lib/meals/favorites";

export const dynamic = "force-dynamic";

export const GET = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  return json(
    { favorites: await listFavorites(user.id, Number.isFinite(limit) ? limit : 50) },
    { headers: { "cache-control": "no-store" } },
  );
};
