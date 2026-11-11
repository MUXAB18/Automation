import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(tsx?|mts)$/.test(name) && !name.endsWith(".test.ts")) yield full;
  }
}

/**
 * `@automation/db` imports the Postgres driver. A client component that imports a VALUE from it breaks the production
 * build ("Can't resolve 'fs'"), even though the dev server may still work. Types are erased, so they are fine.
 */
describe("client components", () => {
  it("import only types from @automation/db", () => {
    const offenders: string[] = [];
    for (const file of files(root)) {
      const src = readFileSync(file, "utf8");
      if (!/^\s*["']use client["']/.test(src)) continue;
      for (const m of src.matchAll(
        /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']@automation\/db["']/g,
      )) {
        const names = m[2]!
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean);
        if (!m[1] && names.some((n) => !n.startsWith("type ")))
          offenders.push(path.relative(root, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
