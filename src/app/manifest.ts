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
    background_color: "#0A0B0B",
    theme_color: "#00C805",
    icons: [
      {src: "/icon", sizes: "192x192", type: "image/png", purpose: "any"},
      {src: "/icon", sizes: "192x192", type: "image/png", purpose: "maskable"},
    ],
  };
}
