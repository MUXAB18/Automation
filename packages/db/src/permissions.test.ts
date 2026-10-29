import { describe, expect, it } from "vitest";
import { can, canCreateCustomer, type Access } from "./permissions";

const access = (role: Access["role"], isPlatformAdmin = false): Access => ({ role, isPlatformAdmin });

describe("can", () => {
  it("lets viewers only view", () => {
    const viewer = access("viewer");
    expect(can(viewer, "customer.view")).toBe(true);
    expect(can(viewer, "customer.update")).toBe(false);
    expect(can(viewer, "customer.status")).toBe(false);
    expect(can(viewer, "website.manage")).toBe(false);
  });

  it("lets members edit but not pause or archive", () => {
    const member = access("member");
    expect(can(member, "customer.update")).toBe(true);
    expect(can(member, "website.manage")).toBe(true);
    expect(can(member, "customer.status")).toBe(false);
  });

  it("lets admins do everything on a customer", () => {
    const admin = access("admin");
    for (const p of ["customer.view", "customer.update", "customer.status", "website.manage"] as const) {
      expect(can(admin, p)).toBe(true);
    }
  });

  it("restricts customer creation to platform admins", () => {
    expect(canCreateCustomer({ isAdmin: true })).toBe(true);
    expect(canCreateCustomer({ isAdmin: false })).toBe(false);
  });
});
