import type { Metadata } from "next";

import { FavoritesView } from "@/components/favorites/favorites-view";
import { requireUser } from "@/lib/auth/session";
import { listFavorites } from "@/lib/meals/favorites";

export const metadata: Metadata = { title: "Favorites" };

export default async function FavoritesPage() {
  const user = await requireUser();
  return <FavoritesView initial={await listFavorites(user.id, 200)} />;
}
