import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Server actions are public HTTP endpoints. This guard fails when someone adds an action file that
 * neither checks the session nor is on the short list of intentionally public actions.
 */
const PUBLIC_ACTION_FILES = new Set([
  "forgot-password/actions.ts", // request a reset email (answers identically for every address)
  "reset-password/actions.ts", // consumes a one-time token
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("server actions", () => {
  const root = path.resolve(import.meta.dirname, "app");
  const files = walk(root).filter(
    (f) => /\.(ts|tsx)$/.test(f) && readFileSync(f, "utf8").trimStart().startsWith('"use server"'),
  );

  it("finds the action files", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it.each(files.map((f) => [path.relative(root, f), f]))("%s authenticates", (relative, file) => {
    if (PUBLIC_ACTION_FILES.has(relative as string)) return;
    const source = readFileSync(file as string, "utf8");
    const actions = source.match(/export async function \w+/g) ?? [];
    const checks = source.match(/requireActor\(|getSession\(|signInAction|signOut/g) ?? [];
    expect(
      checks.length,
      `${relative} must call requireActor() in every action`,
    ).toBeGreaterThanOrEqual(1);
    expect(actions.length).toBeGreaterThan(0);
  });

  it("only allows the documented public actions to skip authentication", () => {
    for (const f of PUBLIC_ACTION_FILES) {
      expect(files.map((x) => path.relative(root, x))).toContain(f);
    }
  });
});
