import path from "node:path";
import { config } from "dotenv";
import { hashPassword } from "better-auth/crypto";
import { loadEnv, seedEnvSchema } from "@automation/config";
import { provisionAgencyRoles, syncRbac, type RoleKey } from "../packages/db/src/rbac";
import { createPrismaClient, type PrismaClient } from "../packages/db/src/unsafe";

config({ path: path.resolve(import.meta.dirname, "../.env"), quiet: true });

/** Global catalogues (providers, metrics). Needed in every environment; safe to re-run. */
async function seedReferenceData(prisma: PrismaClient) {
  const integrations = [
    {
      key: "google_search_console",
      name: "Google Search Console",
      category: "search",
      authType: "oauth2",
    },
    {
      key: "google_analytics_4",
      name: "Google Analytics 4",
      category: "analytics",
      authType: "oauth2",
    },
    { key: "gohighlevel", name: "GoHighLevel", category: "crm", authType: "oauth2" },
    { key: "se_ranking", name: "SE Ranking", category: "seo_data", authType: "api_key" },
    { key: "linkedin", name: "LinkedIn", category: "social", authType: "oauth2" },
    { key: "facebook", name: "Facebook Pages", category: "social", authType: "oauth2" },
    { key: "instagram", name: "Instagram", category: "social", authType: "oauth2" },
    { key: "wordpress", name: "WordPress", category: "cms", authType: "api_key" },
    { key: "moz", name: "Moz", category: "seo_data", authType: "api_key" },
    {
      key: "bing_webmaster",
      name: "Bing Webmaster Tools",
      category: "search",
      authType: "api_key",
    },
  ] as const;
  for (const i of integrations) {
    await prisma.integration.upsert({ where: { key: i.key }, update: { name: i.name }, create: i });
  }

  const metrics = [
    {
      key: "gsc.clicks",
      name: "Search clicks",
      sourceKind: "search_console",
      unit: "count",
      aggregation: "sum",
    },
    {
      key: "gsc.impressions",
      name: "Search impressions",
      sourceKind: "search_console",
      unit: "count",
      aggregation: "sum",
    },
    {
      key: "gsc.ctr",
      name: "Search click-through rate",
      sourceKind: "search_console",
      unit: "ratio",
      aggregation: "avg",
    },
    {
      key: "gsc.position",
      name: "Average search position",
      sourceKind: "search_console",
      unit: "position",
      aggregation: "avg",
    },
    { key: "ga4.sessions", name: "Sessions", sourceKind: "ga4", unit: "count", aggregation: "sum" },
    { key: "ga4.total_users", name: "Users", sourceKind: "ga4", unit: "count", aggregation: "sum" },
    {
      key: "ga4.engaged_sessions",
      name: "Engaged sessions",
      sourceKind: "ga4",
      unit: "count",
      aggregation: "sum",
    },
    {
      key: "ga4.conversions",
      name: "Conversions",
      sourceKind: "ga4",
      unit: "count",
      aggregation: "sum",
    },
    {
      key: "social.followers",
      name: "Followers",
      sourceKind: "social_page",
      unit: "count",
      aggregation: "last",
    },
    {
      key: "social.impressions",
      name: "Social impressions",
      sourceKind: "social_page",
      unit: "count",
      aggregation: "sum",
    },
  ] as const;
  for (const m of metrics) {
    await prisma.metricDefinition.upsert({
      where: { key: m.key },
      update: { name: m.name },
      create: m,
    });
  }
}

type SampleIds = { agencyId: string; clientId: string; websiteId: string; adminId: string };

/** Development-only sample rows so every screen has something to show. Safe to re-run. */
async function seedSampleData(prisma: PrismaClient, ids: SampleIds) {
  const { agencyId, clientId, websiteId, adminId } = ids;
  const tenant = { agencyId, clientId };

  // Give the sample client a realistic profile, but only fill gaps: never overwrite what someone entered.
  await prisma.client.updateMany({
    where: { id: clientId, industry: null },
    data: {
      industry: "Freight and logistics",
      goals: "Grow qualified quote requests from search and keep a steady social presence.",
      targetLocations: ["Ottawa, ON", "Toronto, ON", "Canada"],
      timezone: "America/Toronto",
      accountOwnerId: adminId,
    },
  });

  const project = await prisma.project.upsert({
    where: { clientId_slug: { clientId, slug: "seo" } },
    update: { isSample: true },
    create: {
      ...tenant,
      name: "SEO programme",
      slug: "seo",
      kind: "seo",
      goals: "Rank on page one for core freight and customs terms.",
      createdById: adminId,
      isSample: true,
    },
  });
  // Project membership requires a seat on the client team (agency-wide staff get a role-less one).
  await prisma.clientMembership.upsert({
    where: { userId_clientId: { userId: adminId, clientId } },
    update: {},
    create: { ...tenant, userId: adminId },
  });
  await prisma.projectMembership.createMany({
    data: [{ ...tenant, projectId: project.id, userId: adminId, role: "lead" }],
    skipDuplicates: true,
  });
  await prisma.project.upsert({
    where: { clientId_slug: { clientId, slug: "social-media" } },
    update: { isSample: true },
    create: {
      ...tenant,
      name: "Social media",
      slug: "social-media",
      kind: "social",
      goals: "Post three times a week and grow the LinkedIn audience.",
      createdById: adminId,
      isSample: true,
      settings: {
        social: {
          channels: ["linkedin", "facebook"],
          postsPerWeek: 3,
          requirements: "Every post needs approval before publishing.",
        },
      },
    },
  });
  const seoProject = await prisma.seoProject.upsert({
    where: { projectId_clientId: { projectId: project.id, clientId } },
    update: {},
    create: { ...tenant, projectId: project.id, websiteId },
  });
  for (const term of ["freight forwarding canada", "customs brokerage ottawa", "sarj worldwide"]) {
    await prisma.keyword.upsert({
      where: {
        seoProjectId_term_country_locale_device: {
          seoProjectId: seoProject.id,
          term,
          country: "CA",
          locale: "en",
          device: "desktop",
        },
      },
      update: { isSample: true },
      create: { ...tenant, seoProjectId: seoProject.id, term, isSample: true },
    });
  }
  await prisma.competitor.upsert({
    where: {
      seoProjectId_domain: { seoProjectId: seoProject.id, domain: "example-competitor.ca" },
    },
    update: {},
    create: {
      ...tenant,
      seoProjectId: seoProject.id,
      domain: "example-competitor.ca",
      name: "Example Competitor",
    },
  });

  // Sample tasks: every one is flagged is_sample so the UI labels them as development data.
  const day = 24 * 60 * 60 * 1000;
  const sampleTasks = [
    { title: "Connect Google Search Console", status: "assigned", priority: "high", due: 2 },
    {
      title: "Audit title tags on service pages",
      status: "in_progress",
      priority: "medium",
      due: 5,
    },
    { title: "Draft April blog post outline", status: "ready_for_review", priority: "medium", due: -1 },
    { title: "Fix duplicate meta descriptions", status: "backlog", priority: "low", due: null },
    { title: "Send fortnightly report to client", status: "completed", priority: "medium", due: -3 },
  ] as const;
  for (const t of sampleTasks) {
    const existing = await prisma.task.findFirst({ where: { clientId, title: t.title } });
    if (existing) {
      await prisma.task.update({ where: { id: existing.id }, data: { isSample: true } });
      continue;
    }
    const task = await prisma.task.create({
      data: {
        ...tenant,
        projectId: project.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        type: "general",
        assigneeId: adminId,
        reporterId: adminId,
        dueAt: t.due === null ? null : new Date(Date.now() + t.due * day),
        completedAt: t.status === "completed" ? new Date() : null,
        isSample: true,
      },
    });
    await prisma.taskEvent.create({
      data: {
        ...tenant,
        taskId: task.id,
        actorId: adminId,
        type: "created",
        toValue: { title: task.title },
      },
    });
  }

  await prisma.brandGuideline.upsert({
    where: { clientId_name_version: { clientId, name: "Default voice", version: 1 } },
    update: {},
    create: {
      ...tenant,
      name: "Default voice",
      toneOfVoice: "Professional, clear and helpful.",
      dos: ["Use plain language"],
      donts: ["Make unverifiable claims"],
      isActive: true,
      publishedAt: new Date(),
      createdById: adminId,
    },
  });
  await prisma.contentCalendar.upsert({
    where: { clientId_name: { clientId, name: "Social calendar" } },
    update: {},
    create: { ...tenant, name: "Social calendar", timezone: "America/Toronto" },
  });
  const calendar = await prisma.contentCalendar.findUniqueOrThrow({
    where: { clientId_name: { clientId, name: "Social calendar" } },
  });
  const sampleContent = [
    {
      title: "Spring customs update (LinkedIn)",
      channel: "linkedin",
      type: "social_post",
      status: "scheduled",
      inDays: 3,
    },
    {
      title: "How to choose a freight forwarder",
      channel: "website",
      type: "blog_post",
      status: "in_review",
      inDays: 7,
    },
    {
      title: "Team spotlight",
      channel: "facebook",
      type: "social_post",
      status: "draft",
      inDays: null,
    },
  ] as const;
  for (const c of sampleContent) {
    const exists = await prisma.contentItem.findFirst({ where: { clientId, title: c.title } });
    if (exists) {
      await prisma.contentItem.update({ where: { id: exists.id }, data: { isSample: true } });
      continue;
    }
    await prisma.contentItem.create({
      data: {
        ...tenant,
        calendarId: calendar.id,
        projectId: project.id,
        title: c.title,
        type: c.type,
        channel: c.channel,
        status: c.status,
        scheduledFor: c.inDays === null ? null : new Date(Date.now() + c.inDays * day),
        createdById: adminId,
        isSample: true,
      },
    });
  }
  // A sample notification, marked in its payload so the bell can label it.
  const hasNote = await prisma.notification.findFirst({
    where: { userId: adminId, type: "sample.welcome" },
  });
  if (!hasNote) {
    await prisma.notification.create({
      data: {
        agencyId,
        clientId,
        userId: adminId,
        type: "sample.welcome",
        title: "Sample notification",
        body: "Real notifications (approvals, sync failures, reports) will appear here.",
        data: { sample: true },
      },
    });
  }

  await prisma.reportTemplate.upsert({
    where: { agencyId_slug: { agencyId, slug: "fortnightly-seo" } },
    update: {},
    create: {
      agencyId,
      slug: "fortnightly-seo",
      name: "Fortnightly SEO report",
      isDefault: true,
      layout: [
        { key: "summary", kind: "summary", title: "Summary" },
        {
          key: "search",
          kind: "chart",
          title: "Search performance",
          metrics: ["gsc.clicks", "gsc.impressions"],
        },
        { key: "traffic", kind: "chart", title: "Traffic", metrics: ["ga4.sessions"] },
      ],
    },
  });
  console.log("Sample data ready");
  return project;
}

/** Give a user an agency seat with exactly these roles (idempotent). */
async function grantAgencyRoles(
  prisma: PrismaClient,
  agencyId: string,
  userId: string,
  roleKeys: RoleKey[],
  allClientsAccess: boolean,
) {
  const seat = await prisma.agencyMembership.upsert({
    where: { agencyId_userId: { agencyId, userId } },
    update: { allClientsAccess },
    create: { agencyId, userId, allClientsAccess, joinedAt: new Date() },
  });
  const roles = await prisma.role.findMany({ where: { agencyId, key: { in: roleKeys } } });
  await prisma.agencyMembershipRole.createMany({
    data: roles.map((r) => ({ agencyId, agencyMembershipId: seat.id, roleId: r.id })),
    skipDuplicates: true,
  });
  return seat;
}

async function ensureUser(prisma: PrismaClient, email: string, name: string, password: string) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({ data: { email, name, emailVerified: true } });
    await prisma.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: await hashPassword(password),
      },
    });
  }
  return user;
}

/** Hosts that are plainly a developer machine; dev users are refused anywhere else. */
const isLocalDatabase = (url: string) =>
  ["localhost", "127.0.0.1", "[::1]", "host.docker.internal"].includes(new URL(url).hostname);

/**
 * Development-only sample users, one per role, so every permission can be tried by signing in.
 * Refused in production or against a non-local database, and only created when
 * SEED_DEV_USER_PASSWORD is set (the password is never in the repository).
 */
async function seedDevUsers(
  prisma: PrismaClient,
  env: { DATABASE_URL: string; SEED_DEV_USER_PASSWORD?: string },
  ids: { agencyId: string; clientId: string; projectId: string },
) {
  if (!env.SEED_DEV_USER_PASSWORD) {
    console.log("Dev users skipped (set SEED_DEV_USER_PASSWORD to create one user per role)");
    return;
  }
  if (process.env.NODE_ENV === "production" || !isLocalDatabase(env.DATABASE_URL)) {
    throw new Error(
      "Refusing to create development users outside a local, non-production database",
    );
  }
  const password = env.SEED_DEV_USER_PASSWORD;
  const staff: [string, string, RoleKey][] = [
    ["agency.admin@example.test", "Dev Agency Admin", "agency_admin"],
    ["seo.manager@example.test", "Dev SEO Manager", "seo_manager"],
    ["seo.specialist@example.test", "Dev SEO Specialist", "seo_specialist"],
    ["content.writer@example.test", "Dev Content Writer", "content_writer"],
    ["social.manager@example.test", "Dev Social Media Manager", "social_media_manager"],
    ["reviewer@example.test", "Dev Reviewer", "reviewer"],
  ];
  for (const [email, name, role] of staff) {
    const user = await ensureUser(prisma, email, name, password);
    await grantAgencyRoles(prisma, ids.agencyId, user.id, [role], true);
  }
  // A user with two roles.
  const multi = await ensureUser(prisma, "multi.role@example.test", "Dev Multi-role", password);
  await grantAgencyRoles(
    prisma,
    ids.agencyId,
    multi.id,
    ["seo_specialist", "content_writer"],
    true,
  );

  // An external client user: sees only this client, and only projects they belong to.
  const clientUser = await ensureUser(
    prisma,
    "client.user@example.test",
    "Dev Client User",
    password,
  );
  await grantAgencyRoles(prisma, ids.agencyId, clientUser.id, [], false);
  const seat = await prisma.clientMembership.upsert({
    where: { userId_clientId: { userId: clientUser.id, clientId: ids.clientId } },
    update: {},
    create: { agencyId: ids.agencyId, clientId: ids.clientId, userId: clientUser.id },
  });
  const clientRole = await prisma.role.findFirstOrThrow({
    where: { agencyId: ids.agencyId, key: "client" },
  });
  await prisma.clientMembershipRole.createMany({
    data: [{ agencyId: ids.agencyId, clientMembershipId: seat.id, roleId: clientRole.id }],
    skipDuplicates: true,
  });
  await prisma.projectMembership.upsert({
    where: { projectId_userId: { projectId: ids.projectId, userId: clientUser.id } },
    update: {},
    create: {
      agencyId: ids.agencyId,
      clientId: ids.clientId,
      projectId: ids.projectId,
      userId: clientUser.id,
      role: "viewer",
    },
  });

  // A second agency with its own admin and client, to try cross-tenant access by hand.
  const other = await prisma.agency.upsert({
    where: { slug: "other-agency" },
    update: {},
    create: { name: "Other Agency", slug: "other-agency" },
  });
  await provisionAgencyRoles(prisma, other.id);
  const outsider = await ensureUser(
    prisma,
    "outsider.admin@example.test",
    "Dev Outsider Admin",
    password,
  );
  await grantAgencyRoles(prisma, other.id, outsider.id, ["agency_admin"], true);
  await prisma.client.upsert({
    where: { agencyId_slug: { agencyId: other.id, slug: "other-client" } },
    update: {},
    create: { agencyId: other.id, name: "Other Client", slug: "other-client" },
  });
  console.log("Dev users ready (8 users; second agency 'Other Agency')");
}

async function main() {
  const env = loadEnv(seedEnvSchema);
  const prisma = createPrismaClient(env.DATABASE_URL);

  try {
    const email = env.SEED_ADMIN_EMAIL.toLowerCase();
    let admin = await prisma.user.findUnique({ where: { email } });
    if (!admin) {
      admin = await prisma.user.create({
        data: { email, name: env.SEED_ADMIN_NAME, emailVerified: true, isAdmin: true },
      });
      console.log(`Created admin user ${email}`);
    } else {
      console.log(`Admin user ${email} already exists`);
    }

    // Better Auth expects a credential account whose account_id is the user's id.
    const credential = await prisma.account.findFirst({
      where: { userId: admin.id, providerId: "credential" },
    });
    if (!credential) {
      await prisma.account.create({
        data: {
          userId: admin.id,
          accountId: admin.id,
          providerId: "credential",
          password: await hashPassword(env.SEED_ADMIN_PASSWORD),
        },
      });
    } else if (credential.accountId !== admin.id) {
      await prisma.account.update({ where: { id: credential.id }, data: { accountId: admin.id } });
    }

    await syncRbac(prisma);

    const agency = await prisma.agency.upsert({
      where: { slug: "default-agency" },
      update: {},
      create: { name: "Default Agency", slug: "default-agency" },
    });
    await provisionAgencyRoles(prisma, agency.id);
    await grantAgencyRoles(prisma, agency.id, admin.id, ["agency_admin"], true);

    const client = await prisma.client.upsert({
      where: { agencyId_slug: { agencyId: agency.id, slug: "sarj-worldwide" } },
      update: {},
      create: {
        agencyId: agency.id,
        name: "SARJ Worldwide",
        slug: "sarj-worldwide",
        reportIntervalDays: 15,
      },
    });
    const website = await prisma.website.upsert({
      where: { clientId_domain: { clientId: client.id, domain: "sarjworldwide.ca" } },
      update: {},
      create: {
        agencyId: agency.id,
        clientId: client.id,
        domain: "sarjworldwide.ca",
        isPrimary: true,
      },
    });
    console.log(`Client ready: ${client.name} (sarjworldwide.ca)`);

    await seedReferenceData(prisma);
    if (process.env.NODE_ENV !== "production" && process.env.SEED_SAMPLE_DATA !== "false") {
      const project = await seedSampleData(prisma, {
        agencyId: agency.id,
        clientId: client.id,
        websiteId: website.id,
        adminId: admin.id,
      });
      await seedDevUsers(prisma, env, {
        agencyId: agency.id,
        clientId: client.id,
        projectId: project.id,
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
