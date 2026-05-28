import type { NextConfig } from "next";

/// Tight Content-Security-Policy. Update connect-src whenever a new upstream
/// (RPC, bundler, oracle, analytics) is added — otherwise client-side calls
/// will silently fail.
///
/// Why these directives matter:
///   - default-src 'self'        — fail closed on any directive we forget below.
///   - script-src 'self' 'unsafe-inline'  — Next.js emits inline hydration
///     scripts. Removing 'unsafe-inline' breaks SSR hydration; mitigated by
///     no remote script-src and strict frame-ancestors.
///   - connect-src              — explicit allowlist for fetch/XHR/WebSocket.
///     Anything not here = network error. Bound the surface to the providers
///     this app actually uses.
///   - frame-ancestors 'none'   — kills clickjacking. The wallet-sign click is
///     the highest-value action on the page and must never be overlay-tricked.
///   - object-src 'none'        — no plugins; reduces residual XSS impact.
///   - base-uri 'self'          — prevent <base> tag injection redirects.
///   - form-action 'self'       — POST surfaces are server-controlled.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // Next.js needs inline scripts for hydration. Allow them; everything else is locked.
  // 'unsafe-eval' is dev-only: React reconstructs server stack traces via eval()
  // in dev mode, and Turbopack HMR uses eval for module wiring. Stripped in prod.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  // Tailwind injects inline styles, and next/font emits inline @font-face rules.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  // www.google.com/s2/favicons (used by AssetLogo) 301-redirects to
  // t*.gstatic.com/faviconV2, so both hosts need to be allowlisted.
  "img-src 'self' data: https://www.google.com https://*.gstatic.com https://*.pyth.network https://*.robinhood.com",
  // connect-src: every domain the client may fetch from. Add new upstreams here.
  [
    "connect-src",
    "'self'",
    "https://*.alchemy.com",
    "https://*.alchemyapi.io",
    "https://*.g.alchemy.com",
    "https://hermes.pyth.network",
    "https://benchmarks.pyth.network",
    "https://*.upstash.io",
    "https://rpc.testnet.chain.robinhood.com",
    "https://*.robinhood.com",
    "https://*.walletconnect.com",
    "https://*.walletconnect.org",
    "wss://*.walletconnect.com",
    "wss://*.walletconnect.org",
    "wss://relay.walletconnect.com",
  ].join(" "),
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // Lock down browser feature access. The app needs none of these.
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // HSTS only when running on HTTPS — in dev (`next dev`) the browser would
  // mark localhost as HTTPS-required which breaks subsequent http://localhost
  // sessions. Vercel always serves over HTTPS, so the prod gate is correct.
  ...(process.env.NODE_ENV === "production"
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // Dev origins moved to env. Default to localhost-only.
  allowedDevOrigins: process.env.NEXT_DEV_ALLOWED_ORIGINS?.split(",").filter(
    Boolean,
  ),
  turbopack: {
    root: __dirname,
  },
  outputFileTracingRoot: __dirname,
  // Aggressively tree-shake heavy web3 libs — viem/wagmi re-export hundreds
  // of helpers but a typical client touches a dozen. Without this each
  // import path re-pulls the full module.
  experimental: {
    optimizePackageImports: [
      "viem",
      "wagmi",
      "@rainbow-me/rainbowkit",
      "@tanstack/react-query",
      "ox",
      "permissionless",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
