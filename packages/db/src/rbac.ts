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
  {
    key: "task.manage",
    category: "task",
    description: "Create tasks, update the ones assigned to you, comment and log time",
  },
  {
    key: "task.assign",
    category: "task",
    description: "Assign and reassign tasks, edit any task, cancel tasks",
  },
  {
    key: "task.review",
    category: "task",
    description: "Approve finished tasks or send them back with changes requested",
  },
  { key: "content.view", category: "content", description: "See content and calendars" },
  { key: "content.create", category: "content", description: "Draft content and request approval" },
  { key: "content.approve", category: "content", description: "Approve or reject content" },
  {
    key: "content.publish",
    category: "content",
    description: "Schedule and publish approved content",
  },
  {
    key: "ai.use",
    category: "ai",
    description: "Generate, regenerate and review AI drafts for a client",
  },
  {
    key: "ai.manage",
    category: "ai",
    description: "Approve source material for AI and set AI usage limits",
  },
  { key: "analytics.view", category: "analytics", description: "See analytics and metrics" },
  { key: "report.view", category: "report", description: "See reports" },
  { key: "report.generate", category: "report", description: "Generate and deliver reports" },
  {
    key: "report.approve",
    category: "report",
    description: "Review reports and approve them for the client",
  },
  {
    key: "integration.view",
    category: "integration",
    description: "See integration status, sync history and provider health (never credentials)",
  },
  {
    key: "integration.sync",
    category: "integration",
    description: "Test connections, run syncs and retry failed ones",
  },
  {
    key: "integration.manage",
    category: "integration",
    description: "Connect, reconnect, replace credentials for and disconnect integrations",
  },
  {
    key: "automation.view",
    category: "automation",
    description: "See automation rules, executions and findings",
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

/** The seven product roles. Keys are stable identifiers; names are display text. */
export const ROLE_KEYS = [
  "agency_admin",
  "seo_manager",
  "seo_specialist",
  "content_writer",
  "social_media_manager",
  "reviewer",
  "client",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export type RoleTemplate = {
  /** "agency" roles can be held agency-wide or per client; "client" is the external client role. */
  scope: "agency" | "client";
  key: RoleKey;
  name: string;
  description: string;
  permissions: readonly Permission[];
};

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    scope: "agency",
    key: "agency_admin",
    name: "Agency Admin",
    description: "Runs the agency: people, roles, clients and everything inside them",
    permissions: ALL,
  },
  {
    scope: "agency",
    key: "seo_manager",
    name: "SEO Manager",
    description:
      "Leads SEO for a client: strategy, integrations, automation, reports and approvals",
    permissions: [
      "client.view",
      "client.update",
      "website.manage",
      "project.manage",
      "member.manage",
      "seo.view",
      "seo.manage",
      "task.view",
      "task.manage",
      "task.assign",
      "task.review",
      "content.view",
      "content.create",
      "ai.use",
      "ai.manage",
      "content.approve",
      "analytics.view",
      "report.view",
      "report.approve",
      "report.generate",
      "integration.view",
      "integration.sync",
      "integration.manage",
      "automation.view",
      "automation.manage",
    ],
  },
  {
    scope: "agency",
    key: "seo_specialist",
    name: "SEO Specialist",
    description: "Does the SEO work: keywords, audits, issues, tasks and content drafts",
    permissions: [
      "client.view",
      "seo.view",
      "seo.manage",
      "task.view",
      "task.manage",
      "content.view",
      "content.create",
      "ai.use",
      "integration.view",
      "automation.view",
      "analytics.view",
      "report.view",
    ],
  },
  {
    scope: "agency",
    key: "content_writer",
    name: "Content Writer",
    description: "Drafts content and works on assigned tasks",
    permissions: [
      "client.view",
      "content.view",
      "content.create",
      "ai.use",
      "task.view",
      "task.manage",
      "seo.view",
    ],
  },
  {
    scope: "agency",
    key: "social_media_manager",
    name: "Social Media Manager",
    description: "Plans social content, connects accounts and publishes approved posts",
    permissions: [
      "client.view",
      "content.view",
      "content.create",
      "ai.use",
      "content.publish",
      "integration.view",
      "integration.sync",
      "integration.manage",
      "task.view",
      "task.manage",
      "analytics.view",
      "report.view",
    ],
  },
  {
    scope: "agency",
    key: "reviewer",
    name: "Reviewer",
    description: "Reads everything and approves or rejects content",
    permissions: [
      "client.view",
      "content.view",
      "content.approve",
      "seo.view",
      "task.view",
      "task.review",
      "automation.view",
      "analytics.view",
      "report.view",
      "report.approve",
    ],
  },
  {
    scope: "client",
    key: "client",
    name: "Client",
    description:
      "The client's own people: see results and approve content (only in projects they belong to)",
    permissions: [
      "client.view",
      "content.view",
      "content.approve",
      "analytics.view",
      "report.view",
    ],
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
