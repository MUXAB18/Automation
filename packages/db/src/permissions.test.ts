import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, can, canCreateClient, type Access } from "./permissions";
import { PERMISSIONS, ROLE_TEMPLATES } from "./rbac";

const roleAccess = (scope: "agency" | "client", key: string): Access => {
  const t = ROLE_TEMPLATES.find((r) => r.scope === scope && r.key === key);
  if (!t) throw new Error(`no template ${scope}:${key}`);
  return { permissions: new Set(t.permissions), roles: [key], isPlatformAdmin: false };
};

describe("default client roles", () => {
  it("lets viewers only view", () => {
    const viewer = roleAccess("client", "viewer");
    expect(can(viewer, "client.view")).toBe(true);
    expect(can(viewer, "seo.view")).toBe(true);
    expect(can(viewer, "client.update")).toBe(false);
    expect(can(viewer, "client.status")).toBe(false);
    expect(can(viewer, "website.manage")).toBe(false);
    expect(can(viewer, "content.publish")).toBe(false);
  });

  it("lets members work but not pause, approve or publish", () => {
    const member = roleAccess("client", "member");
    expect(can(member, "client.update")).toBe(true);
    expect(can(member, "website.manage")).toBe(true);
    expect(can(member, "content.create")).toBe(true);
    expect(can(member, "client.status")).toBe(false);
    expect(can(member, "content.approve")).toBe(false);
    expect(can(member, "content.publish")).toBe(false);
  });

  it("lets client admins manage the client but not the agency", () => {
    const admin = roleAccess("client", "admin");
    for (const p of [
      "client.view",
      "client.update",
      "client.status",
      "website.manage",
      "content.approve",
      "content.publish",
      "integration.manage",
    ] as const) {
      expect(can(admin, p), p).toBe(true);
    }
    expect(can(admin, "agency.manage")).toBe(false);
    expect(can(admin, "client.create")).toBe(false);
  });
});

describe("agency roles", () => {
  it("owner holds every permission; admin all but agency.manage; member is read-only", () => {
    expect(roleAccess("agency", "owner").permissions.size).toBe(PERMISSIONS.length);
    const admin = roleAccess("agency", "admin");
    expect(can(admin, "client.create")).toBe(true);
    expect(can(admin, "agency.manage")).toBe(false);
    expect(can(roleAccess("agency", "member"), "client.update")).toBe(false);
  });
});

describe("catalogue", () => {
  it("has unique permission keys and every template permission exists", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of ROLE_TEMPLATES)
      for (const p of t.permissions) expect(ALL_PERMISSIONS.has(p)).toBe(true);
  });

  it("restricts client creation to platform admins", () => {
    expect(canCreateClient({ isAdmin: true })).toBe(true);
    expect(canCreateClient({ isAdmin: false })).toBe(false);
  });
});
