import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["31.57.178.239"],
  turbopack: {
    root: __dirname,
  },
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
