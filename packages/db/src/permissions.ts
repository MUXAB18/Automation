import { PERMISSIONS, type Permission } from "./rbac";

export type { Permission };

/** Effective access of an actor on one client (or agency): the union of their roles' permissions. */
export type Access = {
  permissions: ReadonlySet<Permission>;
  /** Role keys that contributed, e.g. ["admin"] (for display only; always check `permissions`). */
  roles: readonly string[];
  /** True for platform admins (users.is_admin); they hold every permission everywhere. */
  isPlatformAdmin: boolean;
};

export const ALL_PERMISSIONS: ReadonlySet<Permission> = new Set(PERMISSIONS.map((p) => p.key));

export function can(access: Access, permission: Permission): boolean {
  return access.permissions.has(permission);
}

/** Creating clients is not tied to one client, so only platform admins may (for now). */
export function canCreateClient(actor: { isAdmin: boolean }): boolean {
  return actor.isAdmin;
}
