import type { MetadataRoute } from "next";

import { APP_DESCRIPTION, APP_NAME } from "@/config/app";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    short_name: APP_NAME,
    name: APP_NAME,
    description: APP_DESCRIPTION,
    icons: [],
    start_url: ".",
    display: "standalone",
    theme_color: "#0284c7",
    background_color: "#f8fafc",
  };
}
