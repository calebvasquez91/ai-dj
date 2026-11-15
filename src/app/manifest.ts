import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Que DJ",
    short_name: "Que DJ",
    description: "A music app where an AI DJ mixes your songs into one continuous set.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // No lock: an installed app on a tablet or a phone held sideways should rotate with the device.
    orientation: "any",
    background_color: "#f3edff",
    theme_color: "#9333ea",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
