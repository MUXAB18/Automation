import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside the Next.js server bundle; stub it for unit tests.
      "server-only": path.resolve(import.meta.dirname, "test/empty.ts"),
    },
  },
});
