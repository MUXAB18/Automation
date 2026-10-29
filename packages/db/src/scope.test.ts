import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ScopeViolationError } from "./errors";
import { AGENCY_MODELS, GLOBAL_MODELS, TENANT_MODELS, scopeArgs } from "./scope";

const one = { clientIds: ["c1"] };
const many = { clientIds: ["c1", "c2"] };

describe("scopeArgs", () => {
  it("adds a client filter to reads", () => {
    const args = scopeArgs("Website", "findMany", { where: { domain: "a.com" } }, one) as {
      where: { domain: string; AND: unknown[] };
    };
    expect(args.where.domain).toBe("a.com");
    expect(args.where.AND).toContainEqual({ clientId: { in: ["c1"] } });
  });

  it("filters even when no where is given", () => {
    const args = scopeArgs("JobRun", "findMany", undefined, many) as { where: { AND: unknown[] } };
    expect(args.where.AND).toEqual([{ clientId: { in: ["c1", "c2"] } }]);
  });

  it("keeps a caller's own AND clause and still restricts", () => {
    const args = scopeArgs(
      "Website",
      "findFirst",
      { where: { AND: [{ isPrimary: true }] } },
      one,
    ) as {
      where: { AND: unknown[] };
    };
    expect(args.where.AND).toEqual([{ isPrimary: true }, { clientId: { in: ["c1"] } }]);
  });

  it("scopes the client table by id", () => {
    const args = scopeArgs("Client", "findUnique", { where: { id: "c9" } }, one) as {
      where: { AND: unknown[] };
    };
    expect(args.where.AND).toContainEqual({ id: { in: ["c1"] } });
  });

  it("scopes writes and deletes", () => {
    for (const op of ["updateMany", "deleteMany", "update", "delete"]) {
      const args = scopeArgs("Website", op, { where: { id: "w" }, data: {} }, one) as {
        where: { AND: unknown[] };
      };
      expect(args.where.AND, op).toContainEqual({ clientId: { in: ["c1"] } });
    }
  });

  it("injects clientId on create in a single-client scope", () => {
    const args = scopeArgs("Website", "create", { data: { domain: "a.com" } }, one) as {
      data: { clientId: string };
    };
    expect(args.data.clientId).toBe("c1");
  });

  it("rejects creating a row for another client", () => {
    expect(() =>
      scopeArgs("Website", "create", { data: { domain: "a.com", clientId: "c2" } }, one),
    ).toThrow(ScopeViolationError);
  });

  it("requires an explicit clientId in a multi-client scope", () => {
    expect(() => scopeArgs("Website", "create", { data: { domain: "a.com" } }, many)).toThrow(
      ScopeViolationError,
    );
    expect(() =>
      scopeArgs("Website", "create", { data: { domain: "a.com", clientId: "c2" } }, many),
    ).not.toThrow();
  });

  it("checks every row of createMany", () => {
    expect(() =>
      scopeArgs("Website", "createMany", { data: [{ clientId: "c1" }, { clientId: "zzz" }] }, one),
    ).toThrow(ScopeViolationError);
  });

  it("blocks moving a row to another client on update", () => {
    expect(() =>
      scopeArgs("Website", "update", { where: { id: "w" }, data: { clientId: "c2" } }, one),
    ).toThrow(ScopeViolationError);
  });

  it("blocks nested client relations on create", () => {
    expect(() =>
      scopeArgs(
        "Website",
        "create",
        { data: { domain: "a", client: { connect: { id: "c2" } } } },
        one,
      ),
    ).toThrow(ScopeViolationError);
  });

  it("does not let a scoped client create clients", () => {
    expect(() => scopeArgs("Client", "create", { data: { name: "x" } }, one)).toThrow(
      ScopeViolationError,
    );
  });

  it("leaves admin (all) scope untouched", () => {
    const args = { where: { domain: "a.com" } };
    expect(scopeArgs("Website", "findMany", args, { all: true })).toBe(args);
  });

  it("leaves non-tenant models untouched", () => {
    const args = { where: { email: "a@b.c" } };
    expect(scopeArgs("User", "findMany", args, one)).toBe(args);
  });
});

function readModels() {
  const dir = path.resolve(import.meta.dirname, "../prisma/schema");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".prisma"))
    .flatMap((f) => [
      ...readFileSync(path.join(dir, f), "utf8").matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm),
    ])
    .map(([, name, body]) => ({ name: name!, body: body ?? "" }));
}

describe("tenant model registry", () => {
  const models = readModels();

  it("covers every model that has a clientId column", () => {
    const owned = models.filter((m) => /^\s*clientId\s/m.test(m.body));
    expect(owned.length).toBeGreaterThan(40);
    for (const { name } of owned)
      expect(TENANT_MODELS, `${name} must be in TENANT_MODELS`).toHaveProperty(name);
  });

  it("classifies every model as tenant, agency-level or global (no unclassified models)", () => {
    const known = new Set([
      ...Object.keys(TENANT_MODELS),
      ...Object.keys(AGENCY_MODELS),
      ...GLOBAL_MODELS,
    ]);
    for (const { name } of models)
      expect(known, `${name} is not classified in scope.ts`).toContain(name);
    for (const name of known)
      expect(
        models.map((m) => m.name),
        `${name} no longer exists`,
      ).toContain(name);
  });

  it("gives every client-owned model an agencyId so the composite client FK can be enforced", () => {
    for (const { name, body } of models) {
      if (TENANT_MODELS[name] === "clientId" && !["AuditLog", "JobRun"].includes(name)) {
        expect(body, `${name} must have agencyId`).toMatch(/^\s*agencyId\s/m);
      }
    }
  });
});

describe("agency-level models", () => {
  it("are filtered through agencies that contain a scoped client", () => {
    const args = scopeArgs("Role", "findMany", { where: { key: "admin" } }, one) as {
      where: { AND: unknown[] };
    };
    expect(args.where.AND).toContainEqual({
      agency: { clients: { some: { id: { in: ["c1"] } } } },
    });
  });

  it("follow nested paths", () => {
    const args = scopeArgs("NotificationPreference", "findMany", undefined, one) as {
      where: { AND: unknown[] };
    };
    expect(args.where.AND).toContainEqual({
      agencyMembership: { agency: { clients: { some: { id: { in: ["c1"] } } } } },
    });
  });

  it("cannot be created or re-parented from a client scope", () => {
    expect(() => scopeArgs("Role", "create", { data: { key: "x" } }, one)).toThrow(
      ScopeViolationError,
    );
    expect(() =>
      scopeArgs("Role", "update", { where: { id: "r" }, data: { agencyId: "a2" } }, one),
    ).toThrow(ScopeViolationError);
  });
});
