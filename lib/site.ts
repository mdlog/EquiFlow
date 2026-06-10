/// Canonical site origin — single source of truth for metadata, robots and
/// sitemap. The fallback must match the domain used in the hackathon
/// submission (docs/HACKATHON_SUBMISSION.md → https://equiflow.xyz); override
/// per-deploy with NEXT_PUBLIC_SITE_URL.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
  "https://equiflow.xyz";
