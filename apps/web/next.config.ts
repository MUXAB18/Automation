import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

/**
 * The repository root, found by walking up from the working directory to turbo.json. (Not from this file's
 * location: Next compiles this config to a temporary file, so `import.meta.dirname` cannot be trusted.)
 */
function findRepoRoot(from = process.cwd()): string {
  for (let dir = from; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, "turbo.json"))) return dir;
    if (path.dirname(dir) === dir) return from;
  }
}
const repoRoot = findRepoRoot();

// The monorepo keeps a single .env at the root; Next only reads apps/web by default.
// `forceReload`: Next has already loaded (and cached) apps/web's env files by the time it reads this config.
loadEnvConfig(repoRoot, process.env.NODE_ENV !== "production", console, true);

const production = process.env.NODE_ENV === "production";

const baseHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Not a full script policy (Next needs per-request nonces for that): these directives block framing,
  // plugin content, <base> hijacking and cross-origin form posts without touching how scripts load.
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  ...(production
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

// Pages whose URL carries a one-time token: never cached, never sent in a Referer header.
const tokenPageHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "no-store" },
];

// Container builds set NEXT_STANDALONE=1: Next then emits a self-contained server (server.js + only the
// files it needs) so the runtime image stays small. Local `next start` is unaffected.
const standalone = process.env.NEXT_STANDALONE === "1";

const nextConfig: NextConfig = {
  ...(standalone ? { output: "standalone" as const, outputFileTracingRoot: repoRoot } : {}),
  // Task attachments are uploaded through a server action (max 10 MB file + form overhead).
  // A separate output folder lets a build run next to a dev server without overwriting its files.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
  async headers() {
    return [
      { source: "/:path*", headers: baseHeaders },
      { source: "/invite/:token*", headers: tokenPageHeaders },
      { source: "/reset-password", headers: tokenPageHeaders },
    ];
  },
  transpilePackages: ["@automation/db", "@automation/config", "@automation/integrations", "@automation/reports"],
  serverExternalPackages: ["pg", "pdfkit"],
};

export default nextConfig;
