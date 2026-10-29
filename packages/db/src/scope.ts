import type { PrismaClient } from "./generated/client";
import { ScopeViolationError } from "./errors";

/** Which clients a query may touch. `all` must be reached via forAdmin/forSystem. */
export type Scope = { readonly clientIds: readonly string[] } | { readonly all: true };

type Args = Record<string, unknown> | undefined;

/** Prisma model name -> the column that holds the owning client id. */
export const TENANT_MODELS: Record<string, string> = {
  Client: "id",
  Website: "clientId",
  Membership: "clientId",
  JobRun: "clientId",
  AuditLog: "clientId",
  IntegrationConnection: "clientId",
};

const FILTERED_OPS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);
const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn", "upsert"]);

function asArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function assertAllowed(value: unknown, ids: readonly string[], what: string): void {
  if (value === undefined) return;
  if (typeof value !== "string" || !ids.includes(value)) {
    throw new ScopeViolationError(`${what} is outside the allowed client scope`);
  }
}

function scopeCreateData(
  model: string,
  field: string,
  data: Record<string, unknown>,
  ids: readonly string[],
): Record<string, unknown> {
  if (model === "Client") {
    throw new ScopeViolationError("Clients can only be created with admin scope");
  }
  if ("client" in data) {
    throw new ScopeViolationError("Set clientId directly; nested client relations are not allowed");
  }
  if (data[field] === undefined) {
    if (ids.length !== 1) {
      throw new ScopeViolationError(
        `${model}.${field} must be set explicitly in a multi-client scope`,
      );
    }
    return { ...data, [field]: ids[0] };
  }
  assertAllowed(data[field], ids, `${model}.${field}`);
  return data;
}

/**
 * Pure function: rewrites Prisma operation args so they can only touch the
 * scoped clients. Exported for unit tests.
 */
export function scopeArgs(model: string, operation: string, args: Args, scope: Scope): Args {
  const field = TENANT_MODELS[model];
  if (!field || "all" in scope) return args;
  const ids = scope.clientIds;
  const next: Record<string, unknown> = { ...args };

  if (FILTERED_OPS.has(operation)) {
    const where = (next.where as Record<string, unknown> | undefined) ?? {};
    next.where = { ...where, AND: [...asArray(where.AND as never), { [field]: { in: [...ids] } }] };
  }

  if (CREATE_OPS.has(operation)) {
    if (operation === "upsert") {
      next.create = scopeCreateData(model, field, next.create as Record<string, unknown>, ids);
    } else if (operation === "create") {
      next.data = scopeCreateData(model, field, next.data as Record<string, unknown>, ids);
    } else {
      next.data = asArray(next.data as Record<string, unknown> | Record<string, unknown>[]).map(
        (row) => scopeCreateData(model, field, row, ids),
      );
    }
  }

  if (operation.startsWith("update") || operation === "upsert") {
    const update = (operation === "upsert" ? next.update : next.data) as
      Record<string, unknown> | undefined;
    if (update && field !== "id") assertAllowed(update[field], ids, `${model}.${field}`);
  }

  return next;
}

export function createScopedClient(base: PrismaClient, scope: Scope) {
  return base.$extends({
    name: "client-scope",
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(model, operation, args as Args, scope) as typeof args);
        },
      },
    },
  });
}

export type ScopedDb = ReturnType<typeof createScopedClient>;
