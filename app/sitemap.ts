import type { MetadataRoute } from "next";
import { STOCKS } from "@/lib/config/stocks";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
  "https://equiflow.app";

const STATIC_ROUTES: readonly { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/markets", priority: 0.9, changeFrequency: "hourly" },
  { path: "/portfolio", priority: 0.6, changeFrequency: "daily" },
  { path: "/liquidations", priority: 0.7, changeFrequency: "hourly" },
  { path: "/faucet", priority: 0.4, changeFrequency: "weekly" },
  { path: "/governance", priority: 0.4, changeFrequency: "weekly" },
  { path: "/audits", priority: 0.5, changeFrequency: "monthly" },
  { path: "/bug-bounty", priority: 0.4, changeFrequency: "monthly" },
  { path: "/api-reference", priority: 0.5, changeFrequency: "weekly" },
  { path: "/sdk", priority: 0.5, changeFrequency: "weekly" },
  { path: "/tokenomics", priority: 0.5, changeFrequency: "monthly" },
  { path: "/contracts", priority: 0.5, changeFrequency: "weekly" },
  { path: "/docs", priority: 0.6, changeFrequency: "weekly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: `${siteUrl}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
  const assetEntries: MetadataRoute.Sitemap = STOCKS.map((s) => ({
    url: `${siteUrl}/markets/${s.sym}`,
    lastModified: now,
    changeFrequency: "hourly",
    priority: 0.8,
  }));
  return [...staticEntries, ...assetEntries];
}
