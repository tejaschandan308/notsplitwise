import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Log Now. Split Later.",
    short_name: "Log Now",
    display: "standalone",
    start_url: "/",
    background_color: "#f5f1e8",
    theme_color: "#f5f1e8",
    orientation: "portrait",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
