import path from "node:path";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/setup.ts"],
    // Integration tests share one database, so run files one at a time.
    fileParallelism: false,
    // The shared database can be slow when the machine is busy.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
