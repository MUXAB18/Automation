import type { PrismaClient } from "./generated/client";

/**
 * Permission catalogue and default roles. The database is the source of truth at runtime (roles
 * and role_permissions rows); this file is what seeds it. `syncRbac` is idempotent and is run by
 * the seed script and whenever an agency is created.
 */

export const PERMISSIONS = [
  { key: "client.view", category: "client", description: "See a client and its overview" },
  { key: "client.update", category: "client", description: "Edit client details and settings" },
  { key: "client.status", category: "client", description: "Pause or archive a client" },
  { key: "client.create", category: "agency", description: "Create clients in the agency" },
  { key: "website.manage", category: "client", description: "Add and remove client websites" },
  { key: "project.manage", category: "client", description: "Create and edit projects" },
  { key: "member.manage", category: "client", description: "Manage who has access to a client" },
  { key: "seo.view", category: "seo", description: "See keywords, rankings, audits and issues" },
  { key: "seo.manage", category: "seo", description: "Manage keywords, competitors and audits" },
  { key: "task.view", category: "task", description: "See tasks" },
  { key: "task.manage", category: "task", description: "Create, assign and update tasks and time" },
  { key: "content.view", category: "content", description: "See content and calendars" },
  { key: "content.create", category: "content", description: "Draft content and request approval" },
  { key: "content.approve", category: "content", description: "Approve or reject content" },
  {
    key: "content.publish",
    category: "content",
    description: "Schedule and publish approved content",
  },
  { key: "analytics.view", category: "analytics", description: "See analytics and metrics" },
  { key: "report.view", category: "report", description: "See reports" },
  { key: "report.generate", category: "report", description: "Generate and deliver reports" },
  {
    key: "integration.manage",
    category: "integration",
    description: "Connect and disconnect integrations",
  },
  {
    key: "automation.manage",
    category: "automation",
    description: "Create and edit automation rules",
  },
  { key: "agency.members", category: "agency", description: "Manage agency staff and roles" },
  { key: "agency.manage", category: "agency", description: "Change agency settings and templates" },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];

const ALL = PERMISSIONS.map((p) => p.key) as readonly Permission[];
const VIEW: readonly Permission[] = [
  "client.view",
  "seo.view",
  "task.view",
  "content.view",
  "analytics.view",
  "report.view",
];
const WORK: readonly Permission[] = [
  ...VIEW,
  "client.update",
  "website.manage",
  "project.manage",
  "seo.manage",
  "task.manage",
  "content.create",
  "report.generate",
];

export type RoleTemplate = {
  scope: "agency" | "client";
  key: string;
  name: string;
  description: string;
  permissions: readonly Permission[];
};

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    scope: "agency",
    key: "owner",
    name: "Owner",
    description: "Full control of the agency",
    permissions: ALL,
  },
  {
    scope: "agency",
    key: "admin",
    name: "Admin",
    description: "Runs the agency day to day",
    permissions: ALL.filter((p) => p !== "agency.manage"),
  },
  {
    scope: "agency",
    key: "member",
    name: "Member",
    description: "Agency staff (read access)",
    permissions: VIEW,
  },
  {
    scope: "client",
    key: "viewer",
    name: "Viewer",
    description: "Read-only access to a client",
    permissions: VIEW,
  },
  {
    scope: "client",
    key: "member",
    name: "Member",
    description: "Works on a client",
    permissions: WORK,
  },
  {
    scope: "client",
    key: "admin",
    name: "Admin",
    description: "Manages a client",
    permissions: ALL.filter((p) => !p.startsWith("agency.") && p !== "client.create"),
  },
];

/** Create/refresh the permission catalogue. */
async function syncPermissions(prisma: PrismaClient) {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { description: p.description, category: p.category },
      create: p,
    });
  }
}

/** Create the default roles for one agency and make their permissions match the templates. */
export async function provisionAgencyRoles(prisma: PrismaClient, agencyId: string) {
  const permissions = await prisma.permission.findMany({ select: { id: true, key: true } });
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));

  for (const t of ROLE_TEMPLATES) {
    const role = await prisma.role.upsert({
      where: { agencyId_scope_key: { agencyId, scope: t.scope, key: t.key } },
      update: { name: t.name, description: t.description, isSystem: true },
      create: {
        agencyId,
        scope: t.scope,
        key: t.key,
        name: t.name,
        description: t.description,
        isSystem: true,
      },
    });
    const wanted = t.permissions.map((k) => {
      const id = idByKey.get(k);
      if (!id) throw new Error(`Unknown permission ${k}; run syncRbac`);
      return id;
    });
    await prisma.rolePermission.deleteMany({
      where: { roleId: role.id, permissionId: { notIn: wanted } },
    });
    await prisma.rolePermission.createMany({
      data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }
}

/** Sync the catalogue, then bring every agency's system roles in line with the templates. */
export async function syncRbac(prisma: PrismaClient) {
  await syncPermissions(prisma);
  const agencies = await prisma.agency.findMany({ select: { id: true } });
  for (const agency of agencies) await provisionAgencyRoles(prisma, agency.id);
}
