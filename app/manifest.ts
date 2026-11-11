import type { MetadataRoute } from "next";

// The web app manifest: installable, opens full screen on the Today page in portrait.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    // The installed app is called Kal (the in-app text still says Cal for now).
    name: "Kal",
    short_name: "Kal",
    description: "A photo-first food log.",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f6f3",
    theme_color: "#1d7349",
    categories: ["food", "health", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Log a meal",
        url: "/today",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
