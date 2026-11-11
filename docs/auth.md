# Authentication and authorization

How people sign in, how the platform decides what they may do, and how that is enforced. Read with
[database-erd.md](database-erd.md) (tables) and `packages/db/src/{access,authorize,rbac,services/team}.ts` (code).

## Summary

* **Authentication** is [Better Auth](https://www.better-auth.com/) 1.7 (email + password, database-backed sessions, Prisma adapter),
  mounted at `/api/auth/*` in Next.js 16. Sign-up is disabled: accounts come only from an **invitation** or the **seed script**.
* **Authorization** is role-based and checked **on the server, in the data layer**, for every read and write. The browser is never trusted:
  hiding a menu item is cosmetic; the page, server action and database call all re-check.
* **Tenancy**: Agency > Client (> Project). A user's access is the union of the roles they hold on that client
  (per-client roles) and, if the agency granted "all clients" access, their agency-wide roles. Cross-tenant ids always answer *not found*.

## Sign-in, sessions and logout

| Topic | Behaviour |
| --- | --- |
| Password | 12–128 characters, stored as a scrypt hash (Better Auth) in `accounts.password`. |
| Session | Random token in an **HttpOnly, SameSite=Lax** cookie (`__Secure-` prefixed and `Secure` in production). The token maps to a row in `sessions`; it carries no claims. |
| Lifetime | 7 days, sliding (refreshed once a day while in use). No cookie cache: every request re-reads the session, so revoking sessions or deactivating a user takes effect immediately. |
| Logout | Deletes the session row and cookie; recorded as `auth.logout`. |
| Deactivated users | `users.deactivated_at` blocks new sessions, `setUserActive` deletes existing ones, and every authorization check refuses deactivated users. |
| Failed sign-ins | Same message for unknown email, wrong password and deactivated account. Throttled: 5 failures per email and 30 per IP per 15 minutes (counted from `audit_log`, so it works across instances). Better Auth's own HTTP limiter also applies to `/api/auth/*` (5 sign-ins/minute/IP). |
| CSRF | Server actions use Next's origin check; Better Auth validates `Origin` against `APP_URL` for its API. |
| Open redirects | The post-login `next` parameter is accepted only if it is a same-site relative path (`safeRedirectPath`). |
| Headers | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production. Pages with one-time tokens (`/invite/*`, `/reset-password`) are `no-store` and send no referrer. |

## Password reset

1. `/forgot-password` → `requestPasswordResetAction`. The response is **identical** whether or not the email exists, and every request is counted
   (3 per email, 10 per IP per hour) so the limit itself reveals nothing.
2. Better Auth creates a one-time token (1 hour) and calls `sendResetPassword` → `lib/mailer.ts`. The link is
   `/api/auth/reset-password/<token>`, which redirects to `/reset-password?token=…`.
3. `/reset-password` → `resetPasswordAction`. The token is consumed once, the password changes, **all sessions of that user are revoked**
   (`revokeSessionsOnPasswordReset`) and the user signs in again. `auth.password_reset_completed` is audited.

Email: `MAIL_TRANSPORT=log` prints messages to the server console (development only; **refused in production** so one-time links can never reach logs);
`MAIL_TRANSPORT=resend` sends through Resend (`EMAIL_API_KEY`, `EMAIL_FROM`). A send failure is logged and never changes the HTTP response.

## Roles

Seven roles exist in every agency. A user may hold **several** at once; permissions are the **union**.

| Permission | Agency Admin | SEO Manager | SEO Specialist | Content Writer | Social Media Manager | Reviewer | Client |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `client.view` — See a client and its overview | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `client.update` — Edit client details and settings | ✓ | ✓ |  |  |  |  |  |
| `client.status` — Pause or archive a client | ✓ |  |  |  |  |  |  |
| `client.create` — Create clients in the agency | ✓ |  |  |  |  |  |  |
| `website.manage` — Add and remove client websites | ✓ | ✓ |  |  |  |  |  |
| `project.manage` — Create and edit projects | ✓ | ✓ |  |  |  |  |  |
| `member.manage` — Manage who has access to a client | ✓ | ✓ |  |  |  |  |  |
| `seo.view` — See keywords, rankings, audits and issues | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |
| `seo.manage` — Manage keywords, competitors and audits | ✓ | ✓ | ✓ |  |  |  |  |
| `task.view` — See tasks | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `task.manage` — Create, assign and update tasks and time | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `content.view` — See content and calendars | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `content.create` — Draft content and request approval | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `content.approve` — Approve or reject content | ✓ | ✓ |  |  |  | ✓ | ✓ |
| `content.publish` — Schedule and publish approved content | ✓ |  |  |  | ✓ |  |  |
| `analytics.view` — See analytics and metrics | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |
| `report.view` — See reports | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |
| `report.generate` — Generate and deliver reports | ✓ | ✓ |  |  |  |  |  |
| `integration.view` — See integration status, sync history and provider health (never credentials) | ✓ | ✓ | ✓ |  | ✓ |  |  |
| `integration.sync` — Test connections, run syncs and retry failed ones | ✓ | ✓ |  |  | ✓ |  |  |
| `integration.manage` — Connect, reconnect, replace credentials for and disconnect integrations | ✓ | ✓ |  |  | ✓ |  |  |
| `automation.manage` — Create and edit automation rules | ✓ | ✓ |  |  |  |  |  |
| `agency.members` — Manage agency staff and roles | ✓ |  |  |  |  |  |  |
| `agency.manage` — Change agency settings and templates | ✓ |  |  |  |  |  |  |


Notes:

* **Agency Admin** is the only role with agency-level permissions (`agency.members`, `agency.manage`, `client.create`, `client.status`). Those are ignored when an
  Agency Admin role is attached to a single client, so a per-client role can never become agency power.
* **Client** is the external role for the client's own people. It can only be granted through a client-specific invitation, and such users reach a project only if they were added
  to it (`project_memberships`). A person who is *also* staff is not treated as client-only.
* Reviewer and Client approve content; Content Writer and Social Media Manager cannot approve their own work. Publishing additionally needs an approved approval of that exact version, enforced by the database.

### Where roles are held

| Level | Table(s) | Meaning |
| --- | --- | --- |
| Platform | `users.is_admin` | Operates the whole platform: every permission everywhere. Created only by the seed script. |
| Agency | `agency_memberships` + `agency_membership_roles` (+ `all_clients_access`) | Staff seat. Roles apply to **every** client of the agency only when `all_clients_access` is on. |
| Client | `client_memberships` + `client_membership_roles` | Roles on one client (staff assigned to it, or the Client role). |
| Project | `project_memberships` | Restricts users whose only role is Client to the projects they belong to. |

Effective permissions on a client = (per-client roles, minus agency-only permissions) ∪ (agency-wide roles, if `all_clients_access`). A suspended agency seat or a deactivated user has none.

## How a request is authorized

```
request ──► proxy.ts            optimistic: no session cookie → /login (UX only)
        ──► layout / page       requireActor(): verified session from the database, else /login
                                the layout also answers 404 for sections the user cannot use (before streaming)
        ──► server action/page  authorize(actor, {agencyId?, clientId?, projectId?}, permission)
                                   1. ids are cross-checked (project belongs to client, client to agency)
                                   2. actor's roles resolved from the database (never from the request)
                                   3. permission checked; project membership for client-only users
        ──► data access         scoped Prisma client: every query is filtered to the clients the actor may see
        ──► database            composite foreign keys + triggers refuse cross-client/agency links regardless
```

Reusable utilities (`@automation/db`):

| Function | Use |
| --- | --- |
| `requireActor()` (web) | Current signed-in user or redirect. First line of every page, layout and server action. |
| `authorize(actor, target, permission)` | Resolve + check agency/client/project ids from a URL or form. Returns the scoped client for that tenant. |
| `requirePermission(actor, clientId, permission)` / `requireAgencyPermission(...)` | Single-level checks used by the services. |
| `getActorDb(actor)` / `forClient(id)` | Prisma client limited to the actor's clients / one client. Raw client is only in `@automation/db/unsafe`. |
| `listAgenciesWith(actor, permission)` | Agencies where the actor holds a permission (drives the Team screen). |
| `can(access, permission)` | Pure check on a resolved `Access`. |

Error semantics: **no access ⇒ `NotFoundError`** (404) – identical for a client that does not exist and one that belongs to another tenant, so ids cannot be probed.
**Access but missing permission ⇒ `ForbiddenError`.** Both are audited.

## Invitations and team management

* An Agency Admin invites by email with one or more roles (agency-wide, optionally with all-clients access), or invites someone to **one client** (needs `member.manage` on it).
* **No privilege escalation**: nobody can grant a role containing a permission they don't hold themselves (platform admins excepted).
* The token is 32 random bytes; **only its SHA-256 hash is stored**. The link is emailed and shown once to the inviter. It expires in 7 days, works once (an atomic claim), and a newer invitation to the same person/scope revokes older ones.
* `/invite/<token>`: a new person chooses a name and password (the invited email is fixed and counts as verified); an existing user signs in and accepts. An invitation sent to another email cannot be accepted by someone else.
* `setAgencyMemberRoles`, `setClientMemberRoles`, `removeAgencyMember`, `removeClientMember` keep at least one Agency Admin, return the person's assigned tasks to the pool, and cascade their client and project access.
* `/team` (nav item appears only for users who can manage people) lists members, pending invitations and the forms above.

## Audit trail

Written to `audit_log` (append-only; see [database-erd.md](database-erd.md)). Secrets, tokens and passwords are never recorded; login throttling keys are hashes of the email.

| Action | When |
| --- | --- |
| `auth.login_succeeded` / `auth.login_failed` / `auth.logout` | Session created / bad credentials (key = email hash, IP) / sign-out |
| `auth.password_reset_requested` / `auth.password_reset_completed` | Reset asked for (any email) / password changed |
| `invitation.created` / `.revoked` / `.accepted` | Invitation lifecycle (who, roles, scope) |
| `membership.roles_changed` / `membership.removed` | Role edits (before/after) and removals, agency or client level |
| `user.deactivated` / `user.reactivated` | Account lock/unlock by a platform admin |
| `authz.access_denied` | Someone used an id they have no access to (another tenant's client, a mismatched project…) |
| `authz.permission_denied` | Someone with access attempted something their roles forbid (permission recorded) |
| `client.*`, `website.*` | Existing data changes, written in the same transaction as the change |

## Creating the first admin

The platform admin (`users.is_admin`) is created **only** by the seed script, never through the UI:

```bash
cp .env.example .env            # then edit the values below
# SEED_ADMIN_EMAIL=you@yourcompany.com
# SEED_ADMIN_PASSWORD=<at least 12 characters>
# BETTER_AUTH_SECRET=$(openssl rand -base64 32)   ENCRYPTION_KEY=$(openssl rand -base64 32)
npm run db:deploy && npm run db:seed
```

The seed creates the admin (also as Agency Admin with all-clients access of the "Default Agency"), the permission catalogue and role templates. It is idempotent and never changes an existing password.
After signing in, invite the rest of the team from **Team**. Change the admin password with "Forgot password?" if you want to rotate it; remove `SEED_ADMIN_PASSWORD` from `.env` on shared machines.

## Development-only sample users

Set `SEED_DEV_USER_PASSWORD` (12+ characters, git-ignored `.env`) and run `npm run db:seed` to create one user per role, all with that password:

| Email | Role / purpose |
| --- | --- |
| `agency.admin@example.test` | Agency Admin |
| `seo.manager@example.test`, `seo.specialist@example.test`, `content.writer@example.test`, `social.manager@example.test`, `reviewer@example.test` | The other staff roles (agency-wide) |
| `multi.role@example.test` | SEO Specialist + Content Writer |
| `client.user@example.test` | Client role on SARJ Worldwide, member of its SEO project only |
| `outsider.admin@example.test` | Agency Admin of a **second** agency ("Other Agency") – try opening SARJ's URLs with it and expect 404 |

Safety: nothing is created unless the variable is set; the seed **refuses** when `NODE_ENV=production` or the database host is not local; passwords are never in the repository; `.test` addresses are reserved and cannot receive mail.

## Operating notes

* Run behind a reverse proxy (Caddy) that **overwrites** `X-Forwarded-For`; the app trusts it for audit/throttling IPs. Terminate TLS there; production cookies are `Secure`.
* Set `MAIL_TRANSPORT=resend` (+ key, from-address) in production, otherwise invitations still work (link shown to the inviter) but reset emails cannot be sent.
* `BETTER_AUTH_SECRET` signs/derives auth secrets; rotating it signs everyone out.
* Not included (Phase 3 scope): MFA, SSO, a Content-Security-Policy (needs nonces with Next), per-user session management UI, shared (Redis) storage for Better Auth's HTTP rate limiter (action-level throttling is already database-backed).

## Tests

`npm run test` — database-backed suites in `packages/db`:

* `authz.test.ts` – role union, per-client vs agency-wide access, suspended/deactivated users, **id tampering** (project of another client, client of another agency, other tenant's ids), project-scoped Client users, audit of refusals.
* `schema-integrity.test.ts` – the same guarantees straight from PostgreSQL (composite keys, triggers, checks).
* `services/team.test.ts` – invitations (hashing, expiry, single use, wrong email, cross-agency revoke), privilege escalation, last-admin protection, removal clean-up.
* `services/clients.test.ts` – client list/read/write visibility per user.
* `permissions.test.ts` – the role matrix.

And in `apps/web`: proxy rules, redirect safety, mailer fail-closed behaviour, throttle keys, and a guard that every server action authenticates.
