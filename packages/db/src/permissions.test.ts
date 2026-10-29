import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  can,
  canCreateClient,
  isClientRoleOnly,
  type Access,
} from "./permissions";
import { PERMISSIONS, ROLE_KEYS, ROLE_TEMPLATES, type RoleKey } from "./rbac";

const access = (...keys: RoleKey[]): Access => ({
  permissions: new Set(
    ROLE_TEMPLATES.filter((r) => keys.includes(r.key)).flatMap((r) => r.permissions),
  ),
  roles: keys,
  isPlatformAdmin: false,
});

describe("role templates", () => {
  it("defines exactly the seven product roles", () => {
    expect(ROLE_TEMPLATES.map((r) => r.key).sort()).toEqual([...ROLE_KEYS].sort());
    expect(ROLE_KEYS).toHaveLength(7);
  });

  it("only uses permissions that exist, and every role can view its client", () => {
    for (const t of ROLE_TEMPLATES) {
      for (const p of t.permissions) expect(ALL_PERMISSIONS.has(p), `${t.key}:${p}`).toBe(true);
      expect(t.permissions).toContain("client.view");
    }
  });

  it("gives only the Agency Admin the agency-level permissions", () => {
    for (const t of ROLE_TEMPLATES) {
      const agencyLevel = t.permissions.filter(
        (p) => p.startsWith("agency.") || p === "client.create" || p === "client.status",
      );
      if (t.key === "agency_admin") expect(agencyLevel.length).toBeGreaterThan(0);
      else expect(agencyLevel, t.key).toEqual([]);
    }
    expect(access("agency_admin").permissions.size).toBe(PERMISSIONS.length);
  });
});

describe("what each role can do", () => {
  it("SEO Manager manages the client's SEO programme but cannot pause it or run the agency", () => {
    const a = access("seo_manager");
    for (const p of [
      "client.update",
      "seo.manage",
      "integration.manage",
      "report.generate",
      "content.approve",
      "member.manage",
    ] as const) {
      expect(can(a, p), p).toBe(true);
    }
    expect(can(a, "client.status")).toBe(false);
    expect(can(a, "agency.members")).toBe(false);
  });

  it("SEO Specialist does SEO work but cannot edit the client, connect integrations or approve", () => {
    const a = access("seo_specialist");
    expect(can(a, "seo.manage")).toBe(true);
    expect(can(a, "client.update")).toBe(false);
    expect(can(a, "integration.manage")).toBe(false);
    expect(can(a, "content.approve")).toBe(false);
  });

  it("Content Writer drafts content only", () => {
    const a = access("content_writer");
    expect(can(a, "content.create")).toBe(true);
    expect(can(a, "content.approve")).toBe(false);
    expect(can(a, "content.publish")).toBe(false);
    expect(can(a, "seo.manage")).toBe(false);
  });

  it("Social Media Manager publishes but cannot approve their own content", () => {
    const a = access("social_media_manager");
    expect(can(a, "content.publish")).toBe(true);
    expect(can(a, "integration.manage")).toBe(true);
    expect(can(a, "content.approve")).toBe(false);
  });

  it("Reviewer approves and reads but cannot create or change anything", () => {
    const a = access("reviewer");
    expect(can(a, "content.approve")).toBe(true);
    for (const p of [
      "content.create",
      "task.manage",
      "seo.manage",
      "client.update",
      "website.manage",
    ] as const) {
      expect(can(a, p), p).toBe(false);
    }
  });

  it("Client sees results and approves content, nothing else", () => {
    const a = access("client");
    expect(can(a, "report.view")).toBe(true);
    expect(can(a, "content.approve")).toBe(true);
    expect(can(a, "content.create")).toBe(false);
    expect(can(a, "seo.view")).toBe(false);
    expect(isClientRoleOnly(a)).toBe(true);
  });
});

describe("holding several roles", () => {
  it("unions the permissions", () => {
    const both = access("seo_specialist", "content_writer");
    expect(can(both, "seo.manage")).toBe(true);
    expect(can(both, "content.create")).toBe(true);
    expect(can(both, "content.approve")).toBe(false);
  });

  it("a Client who is also staff is no longer client-only", () => {
    expect(isClientRoleOnly(access("client", "reviewer"))).toBe(false);
  });
});

describe("client creation", () => {
  it("is restricted to platform admins", () => {
    expect(canCreateClient({ isAdmin: true })).toBe(true);
    expect(canCreateClient({ isAdmin: false })).toBe(false);
  });
});
