import type { MembershipRole } from "./generated/enums";

export type Permission =
  | "customer.view"
  | "customer.update"
  | "customer.status"
  | "website.manage";

/** Effective access of an actor on one customer. */
export type Access = {
  role: MembershipRole;
  /** True for platform admins (users.is_admin); they hold role "admin" on every customer. */
  isPlatformAdmin: boolean;
};

const MATRIX: Record<MembershipRole, readonly Permission[]> = {
  viewer: ["customer.view"],
  member: ["customer.view", "customer.update", "website.manage"],
  admin: ["customer.view", "customer.update", "customer.status", "website.manage"],
};

export function can(access: Access, permission: Permission): boolean {
  return MATRIX[access.role].includes(permission);
}

/** Creating customers is not tied to one customer, so only platform admins may. */
export function canCreateCustomer(actor: { isAdmin: boolean }): boolean {
  return actor.isAdmin;
}
