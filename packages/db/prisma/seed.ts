import path from "node:path";
import { config } from "dotenv";
import { hashPassword } from "better-auth/crypto";
import { loadEnv, seedEnvSchema } from "@automation/config";
import { provisionAgencyRoles, syncRbac } from "../src/rbac";
import { createPrismaClient, type PrismaClient } from "../src/unsafe";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

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

  const project = await prisma.project.upsert({
    where: { clientId_slug: { clientId, slug: "seo" } },
    update: {},
    create: { ...tenant, name: "SEO programme", slug: "seo", kind: "seo", createdById: adminId },
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
      update: {},
      create: { ...tenant, seoProjectId: seoProject.id, term },
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

  const existingTask = await prisma.task.findFirst({
    where: { clientId, title: "Connect Google Search Console" },
  });
  if (!existingTask) {
    const task = await prisma.task.create({
      data: {
        ...tenant,
        projectId: project.id,
        title: "Connect Google Search Console",
        description: "Authorise read-only access so rankings and clicks can sync.",
        type: "general",
        priority: "high",
        assigneeId: adminId,
        reporterId: adminId,
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
    const ownerRole = await prisma.role.findUniqueOrThrow({
      where: { agencyId_scope_key: { agencyId: agency.id, scope: "agency", key: "owner" } },
    });
    await prisma.agencyMembership.upsert({
      where: { agencyId_userId: { agencyId: agency.id, userId: admin.id } },
      update: {},
      create: {
        agencyId: agency.id,
        userId: admin.id,
        roleId: ownerRole.id,
        allClientsAccess: true,
        joinedAt: new Date(),
      },
    });

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
      await seedSampleData(prisma, {
        agencyId: agency.id,
        clientId: client.id,
        websiteId: website.id,
        adminId: admin.id,
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
