import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// The monorepo keeps a single .env at the root; Next only reads apps/web by default.
loadEnvConfig(path.resolve(import.meta.dirname, "../.."));

const nextConfig: NextConfig = {
  transpilePackages: ["@automation/db", "@automation/config"],
  serverExternalPackages: ["pg"],
};

export default nextConfig;
