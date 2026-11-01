// GET /api/foods/used -> { recent: UsedFood[], frequent: UsedFood[] } for the Add screen.
import type { NextRequest } from "next/server";

import { apiUser, json } from "@/lib/http/route";
import { frequentFoods, recentFoods } from "@/lib/meals/recent-foods";

export const dynamic = "force-dynamic";

export const GET = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const [recent, frequent] = await Promise.all([recentFoods(user.id), frequentFoods(user.id)]);
  return json({ recent, frequent }, { headers: { "cache-control": "no-store" } });
};
