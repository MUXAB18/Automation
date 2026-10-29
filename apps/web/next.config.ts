import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// The monorepo keeps a single .env at the root; Next only reads apps/web by default.
loadEnvConfig(path.resolve(import.meta.dirname, "../.."));

const production = process.env.NODE_ENV === "production";

const baseHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(production
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

// Pages whose URL carries a one-time token: never cached, never sent in a Referer header.
const tokenPageHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "no-store" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: baseHeaders },
      { source: "/invite/:token*", headers: tokenPageHeaders },
      { source: "/reset-password", headers: tokenPageHeaders },
    ];
  },
  transpilePackages: ["@automation/db", "@automation/config"],
  serverExternalPackages: ["pg"],
};

export default nextConfig;
