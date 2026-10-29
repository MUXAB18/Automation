import type { MembershipRole } from "./generated/enums";

export type Permission = "client.view" | "client.update" | "client.status" | "website.manage";

/** Effective access of an actor on one client. */
export type Access = {
  role: MembershipRole;
  /** True for platform admins (users.is_admin); they hold role "admin" on every client. */
  isPlatformAdmin: boolean;
};

const MATRIX: Record<MembershipRole, readonly Permission[]> = {
  viewer: ["client.view"],
  member: ["client.view", "client.update", "website.manage"],
  admin: ["client.view", "client.update", "client.status", "website.manage"],
};

export function can(access: Access, permission: Permission): boolean {
  return MATRIX[access.role].includes(permission);
}

/** Creating clients is not tied to one client, so only platform admins may. */
export function canCreateClient(actor: { isAdmin: boolean }): boolean {
  return actor.isAdmin;
}
