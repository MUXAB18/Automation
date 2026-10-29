import type { PrismaClient } from "./generated/client";
import { ScopeViolationError } from "./errors";

/** Which clients a query may touch. `all` must be reached via forAdmin/forSystem. */
export type Scope = { readonly clientIds: readonly string[] } | { readonly all: true };

type Args = Record<string, unknown> | undefined;

/** Prisma model name -> the column that holds the owning client id. */
export const TENANT_MODELS: Record<string, string> = {
  Client: "id",
  AnalyticsSource: "clientId",
  MetricSnapshot: "clientId",
  AutomationRule: "clientId",
  AutomationRun: "clientId",
  AutomationStepRun: "clientId",
  IdempotencyKey: "clientId",
  ClientMembership: "clientId",
  Project: "clientId",
  ProjectMembership: "clientId",
  Website: "clientId",
  BrandGuideline: "clientId",
  ContentCalendar: "clientId",
  ContentItem: "clientId",
  ContentVersion: "clientId",
  ContentAsset: "clientId",
  AiJob: "clientId",
  AiUsageRecord: "clientId",
  IntegrationAccount: "clientId",
  SyncRun: "clientId",
  SyncError: "clientId",
  WebhookEvent: "clientId",
  Notification: "clientId",
  AuditLog: "clientId",
  JobRun: "clientId",
  ContentApproval: "clientId",
  ApprovalEvent: "clientId",
  PublishingJob: "clientId",
  PublishedPost: "clientId",
  PostMetricSnapshot: "clientId",
  Report: "clientId",
  ReportSection: "clientId",
  ReportDataSnapshot: "clientId",
  ReportDelivery: "clientId",
  SeoProject: "clientId",
  Keyword: "clientId",
  KeywordRankSnapshot: "clientId",
  SiteAudit: "clientId",
  SeoIssue: "clientId",
  SeoIssueHistory: "clientId",
  Competitor: "clientId",
  BacklinkSnapshot: "clientId",
  WebsitePage: "clientId",
  Task: "clientId",
  TaskDependency: "clientId",
  TaskComment: "clientId",
  TaskAttachment: "clientId",
  TaskEvent: "clientId",
  TimeEntry: "clientId",
};

/**
 * Agency-level models (no client_id). From a client scope they are reachable only through agencies
 * that contain one of the scoped clients, and they cannot be created or re-parented there: use
 * forAdmin/forSystem (platform operations) or the agency services. Value = relation path from the
 * model to its Agency.
 */
export const AGENCY_MODELS: Record<string, readonly string[]> = {
  Agency: [],
  AgencyMembership: ["agency"],
  Role: ["agency"],
  RolePermission: ["role", "agency"],
  ReportTemplate: ["agency"],
  NotificationPreference: ["agencyMembership", "agency"],
};

/** Not tenant data: Better Auth tables and global catalogues (permissions, providers, metrics). */
export const GLOBAL_MODELS: readonly string[] = [
  "User",
  "Session",
  "Account",
  "Verification",
  "Permission",
  "Integration",
  "MetricDefinition",
];

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

function scopeAgencyArgs(
  model: string,
  operation: string,
  args: Args,
  path: readonly string[],
  ids: readonly string[],
): Args {
  if (CREATE_OPS.has(operation)) {
    throw new ScopeViolationError(`${model} rows can only be created with admin scope`);
  }
  const next: Record<string, unknown> = { ...args };
  if (FILTERED_OPS.has(operation)) {
    const inClients = { clients: { some: { id: { in: [...ids] } } } };
    const filter = path.reduceRight<Record<string, unknown>>(
      (inner, key) => ({ [key]: inner }),
      inClients,
    );
    const where = (next.where as Record<string, unknown> | undefined) ?? {};
    next.where = { ...where, AND: [...asArray(where.AND as never), filter] };
  }
  if (operation.startsWith("update")) {
    const data = next.data as Record<string, unknown> | undefined;
    if (data && ("agencyId" in data || "agency" in data)) {
      throw new ScopeViolationError(`${model} cannot be moved to another agency`);
    }
  }
  return next;
}

/**
 * Pure function: rewrites Prisma operation args so they can only touch the
 * scoped clients. Exported for unit tests.
 */
export function scopeArgs(model: string, operation: string, args: Args, scope: Scope): Args {
  if ("all" in scope) return args;
  const ids = scope.clientIds;
  const agencyPath = AGENCY_MODELS[model];
  if (agencyPath) return scopeAgencyArgs(model, operation, args, agencyPath, ids);
  const field = TENANT_MODELS[model];
  if (!field) return args;
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
