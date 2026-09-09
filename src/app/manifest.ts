import type {MetadataRoute} from "next";
import {APP_NAME, APP_TAGLINE} from "@/config/app";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_TAGLINE,
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: "#F5F5FF",
    theme_color: "#0D0F18",
    icons: [
      {
        src: "/brand/pwa-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/pwa-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/pwa-icon-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
