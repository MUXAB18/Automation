import { beforeEach, describe, expect, it } from "vitest";
import { forClient } from "./access";
import { createTokenCipherForTests } from "../test/cipher";
import {
  addAgencyStaff,
  addMember,
  makeAgency,
  makeClient,
  makeUser,
  prisma,
  resetDb,
} from "../test/helpers";

/**
 * These tests hit the real database constraints and triggers (the migration's CHECKs, composite
 * foreign keys and trigger functions). They prove isolation does not depend on application code.
 */

beforeEach(resetDb);

async function twoTenants() {
  const agencyA = await makeAgency("Agency A");
  const agencyB = await makeAgency("Agency B");
  const a = await makeClient("Client A", "client-a", agencyA.id);
  const b = await makeClient("Client B", "client-b", agencyB.id);
  const tenantA = { agencyId: agencyA.id, clientId: a.id };
  const tenantB = { agencyId: agencyB.id, clientId: b.id };
  return { agencyA, agencyB, a, b, tenantA, tenantB };
}

const task = (
  tenant: { agencyId: string; clientId: string },
  extra: Record<string, unknown> = {},
) => prisma().task.create({ data: { ...tenant, title: "T", ...extra } });

describe("composite tenant keys", () => {
  it("rejects a row whose client belongs to a different agency", async () => {
    const { agencyB, a } = await twoTenants();
    await expect(task({ agencyId: agencyB.id, clientId: a.id })).rejects.toThrow();
  });

  it("rejects linking a task to another client's project", async () => {
    const { tenantA, tenantB } = await twoTenants();
    const projectB = await prisma().project.create({ data: { ...tenantB, name: "P", slug: "p" } });
    await expect(task(tenantA, { projectId: projectB.id })).rejects.toThrow();
    await expect(task(tenantB, { projectId: projectB.id })).resolves.toBeTruthy();
  });

  it("rejects a task dependency across clients", async () => {
    const { tenantA, tenantB } = await twoTenants();
    const t1 = await task(tenantA);
    const t2 = await task(tenantB);
    await expect(
      prisma().taskDependency.create({
        data: { ...tenantA, taskId: t1.id, dependsOnTaskId: t2.id },
      }),
    ).rejects.toThrow();
  });

  it("rejects a task depending on itself", async () => {
    const { tenantA } = await twoTenants();
    const t = await task(tenantA);
    await expect(
      prisma().taskDependency.create({ data: { ...tenantA, taskId: t.id, dependsOnTaskId: t.id } }),
    ).rejects.toThrow();
  });

  it("rejects a report built from another agency's template", async () => {
    const { agencyB, tenantA } = await twoTenants();
    const template = await prisma().reportTemplate.create({
      data: { agencyId: agencyB.id, slug: "t", name: "T" },
    });
    await expect(
      prisma().report.create({
        data: {
          ...tenantA,
          templateId: template.id,
          title: "R",
          periodStart: new Date("2026-01-01"),
          periodEnd: new Date("2026-01-15"),
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a report whose period ends before it starts", async () => {
    const { tenantA } = await twoTenants();
    await expect(
      prisma().report.create({
        data: {
          ...tenantA,
          title: "R",
          periodStart: new Date("2026-02-01"),
          periodEnd: new Date("2026-01-01"),
        },
      }),
    ).rejects.toThrow();
  });

  it("only lets agency members become client members, with a client-scope role of their agency", async () => {
    const { agencyA, agencyB, a } = await twoTenants();
    const outsider = await makeUser();
    const clientRoleB = await prisma().role.findUniqueOrThrow({
      where: { agencyId_scope_key: { agencyId: agencyB.id, scope: "client", key: "viewer" } },
    });
    await expect(
      prisma().clientMembership.create({
        data: {
          agencyId: agencyA.id,
          clientId: a.id,
          userId: outsider.userId,
          roleId: clientRoleB.id,
        },
      }),
    ).rejects.toThrow();

    await addAgencyStaff(outsider, agencyA.id);
    const agencyRole = await prisma().role.findUniqueOrThrow({
      where: { agencyId_scope_key: { agencyId: agencyA.id, scope: "agency", key: "member" } },
    });
    await expect(
      prisma().clientMembership.create({
        data: {
          agencyId: agencyA.id,
          clientId: a.id,
          userId: outsider.userId,
          roleId: agencyRole.id,
        },
      }),
    ).rejects.toThrow(/not a client role/);
    await expect(addMember(outsider, a.id, "viewer")).resolves.toBeTruthy();
  });
});

describe("user access triggers", () => {
  it("only lets people with access to the client be assigned its tasks", async () => {
    const { tenantA, a, agencyA } = await twoTenants();
    const stranger = await makeUser();
    await expect(task(tenantA, { assigneeId: stranger.userId })).rejects.toThrow(
      /no access to client/,
    );

    const member = await makeUser();
    await addMember(member, a.id, "member");
    await expect(task(tenantA, { assigneeId: member.userId })).resolves.toBeTruthy();

    const staff = await makeUser();
    await addAgencyStaff(staff, agencyA.id, "member", true);
    await expect(task(tenantA, { assigneeId: staff.userId })).resolves.toBeTruthy();

    const staffWithoutAccess = await makeUser();
    await addAgencyStaff(staffWithoutAccess, agencyA.id, "member", false);
    await expect(task(tenantA, { assigneeId: staffWithoutAccess.userId })).rejects.toThrow(
      /no access/,
    );
  });

  it("lets platform admins be assigned anywhere", async () => {
    const { tenantA } = await twoTenants();
    const admin = await makeUser(true);
    await expect(task(tenantA, { assigneeId: admin.userId })).resolves.toBeTruthy();
  });
});

describe("integration secrets and duplicates", () => {
  async function setup() {
    const t = await twoTenants();
    const integration = await prisma().integration.create({
      data: { key: "google_search_console", name: "GSC", category: "search", authType: "oauth2" },
    });
    return { ...t, integration };
  }

  it("rejects plaintext credentials and accepts real ciphertext", async () => {
    const { tenantA, integration } = await setup();
    const data = {
      ...tenantA,
      integrationId: integration.id,
      externalAccountId: "acct-1",
      scopes: [],
    };
    await expect(
      prisma().integrationAccount.create({
        data: { ...data, encryptedCredentials: "ya29.plaintext-access-token" },
      }),
    ).rejects.toThrow();
    const cipher = createTokenCipherForTests();
    const encrypted = cipher.encrypt("refresh-token", `${tenantA.clientId}:google`);
    await expect(
      prisma().integrationAccount.create({ data: { ...data, encryptedCredentials: encrypted } }),
    ).resolves.toBeTruthy();
  });

  it("prevents duplicate provider accounts for a client but allows them for another client", async () => {
    const { tenantA, tenantB, integration } = await setup();
    const encrypted = createTokenCipherForTests().encrypt("t", "ctx");
    const base = {
      integrationId: integration.id,
      externalAccountId: "acct-1",
      scopes: [],
      encryptedCredentials: encrypted,
    };
    await prisma().integrationAccount.create({ data: { ...tenantA, ...base } });
    await expect(
      prisma().integrationAccount.create({ data: { ...tenantA, ...base } }),
    ).rejects.toThrow();
    await expect(
      prisma().integrationAccount.create({ data: { ...tenantB, ...base } }),
    ).resolves.toBeTruthy();
  });

  it("rejects using another client's integration account for a sync run", async () => {
    const { tenantA, tenantB, integration } = await setup();
    const encrypted = createTokenCipherForTests().encrypt("t", "ctx");
    const accountB = await prisma().integrationAccount.create({
      data: {
        ...tenantB,
        integrationId: integration.id,
        externalAccountId: "b",
        scopes: [],
        encryptedCredentials: encrypted,
      },
    });
    await expect(
      prisma().syncRun.create({ data: { ...tenantA, integrationAccountId: accountB.id } }),
    ).rejects.toThrow();
  });

  it("de-duplicates webhook deliveries per provider", async () => {
    const { integration } = await setup();
    const event = {
      integrationId: integration.id,
      externalEventId: "evt-1",
      eventType: "x",
      payload: {},
    };
    await prisma().webhookEvent.create({ data: event });
    await expect(prisma().webhookEvent.create({ data: event })).rejects.toThrow();
  });
});

describe("history is kept", () => {
  async function metricSetup() {
    const t = await twoTenants();
    const integration = await prisma().integration.create({
      data: { key: "ga4", name: "GA4", category: "analytics", authType: "oauth2" },
    });
    const account = await prisma().integrationAccount.create({
      data: {
        ...t.tenantA,
        integrationId: integration.id,
        externalAccountId: "acct",
        scopes: [],
        encryptedCredentials: createTokenCipherForTests().encrypt("t", "ctx"),
      },
    });
    const source = await prisma().analyticsSource.create({
      data: { ...t.tenantA, integrationAccountId: account.id, kind: "ga4", externalId: "prop-1" },
    });
    const metric = await prisma().metricDefinition.create({
      data: { key: "ga4.sessions", name: "Sessions", sourceKind: "ga4", unit: "count" },
    });
    const run = () =>
      prisma().syncRun.create({
        data: { ...t.tenantA, integrationAccountId: account.id, analyticsSourceId: source.id },
      });
    return { ...t, source, metric, run };
  }

  it("keeps a snapshot per sync run and rejects duplicates inside one run", async () => {
    const { tenantA, source, metric, run } = await metricSetup();
    const first = await run();
    const second = await run();
    const row = (syncRunId: string, value: number) => ({
      ...tenantA,
      analyticsSourceId: source.id,
      metricDefinitionId: metric.id,
      syncRunId,
      periodStart: new Date("2026-01-01"),
      value,
    });
    await prisma().metricSnapshot.create({ data: row(first.id, 10) });
    await prisma().metricSnapshot.create({ data: row(second.id, 12) }); // revised value: new row
    await expect(prisma().metricSnapshot.create({ data: row(second.id, 13) })).rejects.toThrow();
    expect(await prisma().metricSnapshot.count()).toBe(2);
  });

  it("refuses to update snapshots, history and versions", async () => {
    const { tenantA, source, metric, run } = await metricSetup();
    const r = await run();
    const snap = await prisma().metricSnapshot.create({
      data: {
        ...tenantA,
        analyticsSourceId: source.id,
        metricDefinitionId: metric.id,
        syncRunId: r.id,
        periodStart: new Date("2026-01-01"),
        value: 1,
      },
    });
    await expect(
      prisma().metricSnapshot.update({ where: { id: snap.id }, data: { value: 2 } }),
    ).rejects.toThrow(/append-only/);

    const t = await task(tenantA);
    const ev = await prisma().taskEvent.create({
      data: { ...tenantA, taskId: t.id, type: "created" },
    });
    await expect(
      prisma().taskEvent.update({ where: { id: ev.id }, data: { type: "updated" } }),
    ).rejects.toThrow(/append-only/);

    const item = await prisma().contentItem.create({
      data: { ...tenantA, title: "C", type: "blog_post", channel: "website" },
    });
    const v = await prisma().contentVersion.create({
      data: { ...tenantA, contentItemId: item.id, versionNo: 1, body: "x" },
    });
    await expect(
      prisma().contentVersion.update({ where: { id: v.id }, data: { body: "y" } }),
    ).rejects.toThrow(/append-only/);
  });
});

describe("approval before publishing", () => {
  async function publishSetup() {
    const t = await twoTenants();
    const admin = await makeUser(true);
    const integration = await prisma().integration.create({
      data: { key: "linkedin", name: "LinkedIn", category: "social", authType: "oauth2" },
    });
    const account = await prisma().integrationAccount.create({
      data: {
        ...t.tenantA,
        integrationId: integration.id,
        externalAccountId: "page",
        scopes: [],
        encryptedCredentials: createTokenCipherForTests().encrypt("t", "ctx"),
      },
    });
    const item = await prisma().contentItem.create({
      data: { ...t.tenantA, title: "Post", type: "social_post", channel: "linkedin" },
    });
    const v1 = await prisma().contentVersion.create({
      data: { ...t.tenantA, contentItemId: item.id, versionNo: 1, body: "one" },
    });
    const v2 = await prisma().contentVersion.create({
      data: { ...t.tenantA, contentItemId: item.id, versionNo: 2, body: "two" },
    });
    const approval = (versionId: string, status: "pending" | "approved") =>
      prisma().contentApproval.create({
        data: {
          ...t.tenantA,
          contentItemId: item.id,
          contentVersionId: versionId,
          status,
          ...(status === "approved" ? { decidedById: admin.userId, decidedAt: new Date() } : {}),
        },
      });
    const job = (versionId: string, approvalId: string) =>
      prisma().publishingJob.create({
        data: {
          ...t.tenantA,
          contentItemId: item.id,
          contentVersionId: versionId,
          contentApprovalId: approvalId,
          integrationAccountId: account.id,
        },
      });
    return { ...t, item, v1, v2, approval, job };
  }

  it("blocks publishing without an approved approval of that version", async () => {
    const { v1, v2, approval, job } = await publishSetup();
    const pending = await approval(v1.id, "pending");
    await expect(job(v1.id, pending.id)).rejects.toThrow();
    const approvedV1 = await approval(v1.id, "approved");
    await expect(job(v2.id, approvedV1.id)).rejects.toThrow(); // approval is for version 1
    await expect(job(v1.id, approvedV1.id)).resolves.toBeTruthy();
  });

  it("rejects a decided approval with no decision time", async () => {
    const { tenantA, item, v1 } = await publishSetup();
    await expect(
      prisma().contentApproval.create({
        data: { ...tenantA, contentItemId: item.id, contentVersionId: v1.id, status: "approved" },
      }),
    ).rejects.toThrow();
  });

  it("rejects an approval that pairs a version with a different item", async () => {
    const { tenantA, v1 } = await publishSetup();
    const other = await prisma().contentItem.create({
      data: { ...tenantA, title: "Other", type: "blog_post", channel: "website" },
    });
    await expect(
      prisma().contentApproval.create({
        data: { ...tenantA, contentItemId: other.id, contentVersionId: v1.id },
      }),
    ).rejects.toThrow();
  });

  it("only accepts a current version that belongs to the same item", async () => {
    const { tenantA, item, v1 } = await publishSetup();
    await expect(
      prisma().contentItem.update({ where: { id: item.id }, data: { currentVersionId: v1.id } }),
    ).resolves.toBeTruthy();
    const other = await prisma().contentItem.create({
      data: { ...tenantA, title: "Other", type: "blog_post", channel: "website" },
    });
    await expect(
      prisma().contentItem.update({ where: { id: other.id }, data: { currentVersionId: v1.id } }),
    ).rejects.toThrow(/same content item/);
  });
});

describe("audit log", () => {
  it("fills the agency from the client and rejects a mismatch", async () => {
    const { agencyA, agencyB, a } = await twoTenants();
    const row = await prisma().auditLog.create({
      data: { clientId: a.id, action: "x", entityType: "client", entityId: a.id },
    });
    expect(row.agencyId).toBe(agencyA.id);
    await expect(
      prisma().auditLog.create({
        data: {
          clientId: a.id,
          agencyId: agencyB.id,
          action: "x",
          entityType: "client",
          entityId: a.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("cannot be edited or deleted", async () => {
    const { a } = await twoTenants();
    const row = await prisma().auditLog.create({
      data: { clientId: a.id, action: "x", entityType: "client", entityId: a.id },
    });
    await expect(
      prisma().auditLog.update({ where: { id: row.id }, data: { action: "y" } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma().auditLog.delete({ where: { id: row.id } })).rejects.toThrow(
      /append-only/,
    );
  });
});

describe("safe deletion", () => {
  it("cannot delete an agency that still has clients", async () => {
    const { agencyA } = await twoTenants();
    await expect(prisma().agency.delete({ where: { id: agencyA.id } })).rejects.toThrow();
  });

  it("purging a client removes its data but keeps its audit trail", async () => {
    const { tenantA, a } = await twoTenants();
    const t = await task(tenantA);
    await prisma().auditLog.create({
      data: { clientId: a.id, action: "client.created", entityType: "client", entityId: a.id },
    });
    await prisma().client.delete({ where: { id: a.id } });
    expect(await prisma().task.count({ where: { id: t.id } })).toBe(0);
    expect(await prisma().auditLog.count({ where: { clientId: a.id } })).toBe(1);
  });

  it("purges a fully populated client even though cross-references use Restrict", async () => {
    const { tenantA, a, agencyA } = await twoTenants();
    const admin = await makeUser(true);
    const project = await prisma().project.create({ data: { ...tenantA, name: "P", slug: "p" } });
    const site = await prisma().website.create({ data: { ...tenantA, domain: "a.com" } });
    await prisma().seoProject.create({
      data: { ...tenantA, projectId: project.id, websiteId: site.id },
    });
    await task(tenantA, { projectId: project.id, assigneeId: admin.userId });
    const integration = await prisma().integration.create({
      data: { key: "linkedin", name: "LinkedIn", category: "social", authType: "oauth2" },
    });
    const account = await prisma().integrationAccount.create({
      data: {
        ...tenantA,
        integrationId: integration.id,
        externalAccountId: "page",
        scopes: [],
        encryptedCredentials: createTokenCipherForTests().encrypt("t", "ctx"),
      },
    });
    const item = await prisma().contentItem.create({
      data: {
        ...tenantA,
        projectId: project.id,
        title: "Post",
        type: "social_post",
        channel: "linkedin",
      },
    });
    const version = await prisma().contentVersion.create({
      data: { ...tenantA, contentItemId: item.id, versionNo: 1, body: "x" },
    });
    await prisma().contentItem.update({
      where: { id: item.id },
      data: { currentVersionId: version.id },
    });
    const approval = await prisma().contentApproval.create({
      data: {
        ...tenantA,
        contentItemId: item.id,
        contentVersionId: version.id,
        status: "approved",
        decidedAt: new Date(),
      },
    });
    const job = await prisma().publishingJob.create({
      data: {
        ...tenantA,
        contentItemId: item.id,
        contentVersionId: version.id,
        contentApprovalId: approval.id,
        integrationAccountId: account.id,
      },
    });
    await prisma().publishedPost.create({
      data: {
        ...tenantA,
        publishingJobId: job.id,
        contentItemId: item.id,
        integrationAccountId: account.id,
        externalPostId: "urn:1",
        publishedAt: new Date(),
      },
    });
    const template = await prisma().reportTemplate.create({
      data: { agencyId: agencyA.id, slug: "t", name: "T" },
    });
    await prisma().report.create({
      data: {
        ...tenantA,
        templateId: template.id,
        title: "R",
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-01-15"),
      },
    });

    await prisma().client.delete({ where: { id: a.id } });
    expect(await prisma().publishedPost.count()).toBe(0);
    expect(await prisma().report.count()).toBe(0);
    expect(await prisma().reportTemplate.count()).toBe(1); // agency-level, kept
  });

  it("keeps task history when a user is removed", async () => {
    const { tenantA, a } = await twoTenants();
    const member = await makeUser();
    await addMember(member, a.id, "member");
    const t = await task(tenantA, { assigneeId: member.userId });
    await prisma().user.delete({ where: { id: member.userId } });
    expect((await prisma().task.findUniqueOrThrow({ where: { id: t.id } })).assigneeId).toBeNull();
  });
});

describe("scoped access to agency-level tables", () => {
  it("shows a client scope only its own agency's roles", async () => {
    const { a, agencyA } = await twoTenants();
    const roles = await forClient(a.id).role.findMany();
    expect(roles.length).toBeGreaterThan(0);
    expect(roles.every((r) => r.agencyId === agencyA.id)).toBe(true);
  });
});
