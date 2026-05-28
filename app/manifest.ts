import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EquiFlow",
    short_name: "EquiFlow",
    description:
      "Yield-generating stock collateralization on Robinhood Chain (Arbitrum L3).",
    start_url: "/",
    display: "standalone",
    background_color: "#FAF8F2",
    theme_color: "#1A1814",
    icons: [
      { src: "/icon.png", sizes: "192x192", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
