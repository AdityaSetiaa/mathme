import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "mathme — mental math trainer",
    short_name: "mathme",
    description: "Mental-math training: measure accuracy and speed, find weak spots, improve.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f7f5",
    theme_color: "#2a78d6",
    icons: [
      { src: "/icons/192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
