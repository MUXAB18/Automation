import { describe, expect, it } from "vitest";
import { can, canCreateClient, type Access } from "./permissions";

const access = (role: Access["role"], isPlatformAdmin = false): Access => ({
  role,
  isPlatformAdmin,
});

describe("can", () => {
  it("lets viewers only view", () => {
    const viewer = access("viewer");
    expect(can(viewer, "client.view")).toBe(true);
    expect(can(viewer, "client.update")).toBe(false);
    expect(can(viewer, "client.status")).toBe(false);
    expect(can(viewer, "website.manage")).toBe(false);
  });

  it("lets members edit but not pause or archive", () => {
    const member = access("member");
    expect(can(member, "client.update")).toBe(true);
    expect(can(member, "website.manage")).toBe(true);
    expect(can(member, "client.status")).toBe(false);
  });

  it("lets admins do everything on a client", () => {
    const admin = access("admin");
    for (const p of ["client.view", "client.update", "client.status", "website.manage"] as const) {
      expect(can(admin, p)).toBe(true);
    }
  });

  it("restricts client creation to platform admins", () => {
    expect(canCreateClient({ isAdmin: true })).toBe(true);
    expect(canCreateClient({ isAdmin: false })).toBe(false);
  });
});
