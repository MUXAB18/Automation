# Client and project management (Phase 5)

Create, view, edit, search, archive and organise clients and their projects. Everything is stored in PostgreSQL through Prisma
(see [database-erd.md](database-erd.md)); no integration is implemented, so integration status is read from the relational tables only.

## Where each piece of information lives

| Information | Stored in | Notes |
| --- | --- | --- |
| Business name, slug, status, industry, goals, target locations, time zone, language | `clients` columns | Length limits are CHECK constraints as well as form validation |
| Websites | `websites` (unique per client) | Edited on the client's Settings tab |
| Reporting schedule | `clients.report_interval_days`, `report_email` + `settings.preferences` | Preferences: delivery (email/download), preferred weekday, weekly summary |
| Account owner | `clients.account_owner_id` | A trigger requires the owner to have access to the client |
| Authorized team members | `client_memberships` + `client_membership_roles` | One or more of the seven roles per person |
| Brand guidelines | `brand_guidelines` | One logical guideline; every save is a new **version**, only one is active |
| Integration status, latest sync | `integration_accounts`, `sync_runs` | Read-only here; credentials are never selected |
| Project name, type, goals, status, dates | `projects` | `ends_on >= starts_on` is a CHECK |
| Project people | `project_memberships` | Must be on the client's team (composite FK) |
| SEO targets | `seo_projects` (website, country, language, goals in `settings.targets`) + `keywords` | Removing a keyword switches it off; history is kept |
| Social requirements | `projects.settings.social` + a `content_calendars` row | Channels, posts per week, free-text requirements |
| Project tasks, issues, content, metrics | `tasks`, `seo_issues` (via the SEO project), `content_items`, analytics sources of the project's website | Linked by `project_id`; shown on the project page |

## Pages

| URL | What it does | Needs |
| --- | --- | --- |
| `/clients` | Search (name, industry, website), filter (status, "I am the owner"), sort, page, archive/restore | `client.view`; archive needs `client.status` |
| `/clients/new` | Create a client with the whole profile (becomes its account owner when eligible) | `client.create` in an agency (Agency Admin) or platform admin |
| `/clients/[id]` | Overview: profile, integration status and latest sync, active projects, tasks, reports, recent activity | `client.view`; each block needs its own permission |
| `/clients/[id]/team` | Account owner, team members and roles, add/remove people | read: `client.view`; change: `member.manage` |
| `/clients/[id]/brand` | Brand guidelines with version history | read: `client.view`; save: `client.update` |
| `/clients/[id]/edit` | Edit the profile, manage websites | `client.update`, `website.manage` |
| `/projects` | Search (name, goals, client), filter (status, type, archived), page, archive/restore | `client.view`; archive needs `project.manage` |
| `/projects/new` | Create a project: details, people, SEO targets, social requirements | `project.manage` (+ `seo.manage` for SEO targets) |
| `/projects/[id]` | Overview, people, SEO targets and keywords, social requirements, tasks, content, issues, metrics, activity | `client.view`; Client-role users only for projects they belong to |
| `/projects/[id]/edit` | Edit everything above | `project.manage` |

A page the user may not open answers a real **HTTP 404** (the same as a record that does not exist). List pages show a loading skeleton; record pages
deliberately do not sit under a loading boundary, because streaming would send a 200 before the page could say "not found".

## Server-side rules (`packages/db/src/services/{clients,brand,projects,team}.ts`)

* **Every operation authorises first.** Clients: `requirePermission(actor, clientId, …)`. Projects: `authorize(actor, { projectId }, …)`, which loads the project,
  derives its client and checks the actor's roles on **that** client, so a project id from another client or agency is "not found". The ids in URLs and forms are never trusted.
* **Transactions.** `createClient` (client + website + audit), `createProject` (project + people + client-team seats for agency-wide staff + SEO project + keywords + social
  settings + calendar + audit), `updateProject`, `saveBrandGuideline` (deactivate old version + create new + audit), `addClientMember` (membership + roles + audit) and
  `setAccountOwner` each run in one transaction. If any part fails, nothing is saved (tested: a website that belongs to another client rolls the whole project back).
* **Audit.** Each create/update/archive/ownership/membership change writes `audit_log` in the same transaction with before/after values.
* **Validation** (Zod, in `schemas.ts`): trimmed text with limits, e-mail, time zone must be a real IANA zone, language from a list, report interval 1–365 days,
  up to 25 locations / 100 keywords / 50 banned terms, dates `YYYY-MM-DD` with end ≥ start, SEO projects need a website of the same client, social projects need a channel.
  Errors come back by field name and are shown next to the field; the form keeps what the user typed.
* **Roles and limits.** Nobody can assign a role beyond their own permissions. Project people must be on the client's team; agency-wide staff are given a role-less seat so the
  foreign key holds. Removing someone from a client or agency also unassigns their tasks and clears them as account owner.
* **Archiving never deletes.** Clients and projects get `archived_at`/status; tasks, content, keywords, history and audit stay and the item can be restored.

## Tests

`pnpm --filter @automation/db test`:

* `client-management.test.ts` – ownership (creator becomes owner, owner must work on the client, database trigger as backstop, owner cleared on removal), profile validation, atomic create, permissions per role and per agency, team management, search/filter/paging, brand versions, client page sections, cross-tenant access.
* `projects.test.ts` – full project creation and relationships, rollback on a foreign website or an ineligible person, validation, permissions (including `seo.manage`), cross-client ids, update with keyword history, archive/restore, search, project detail sections per role and for Client users.

`pnpm --filter @automation/web test` – `form-input.test.ts` checks that what each form posts is accepted by the real validation schemas and that errors use the same field names the forms display.

## Not in this phase

Creating tasks, content or reports from the project page; hard-deleting clients or projects; connecting integrations (their status is shown, the connect flow is not built);
a visual review of the forms in a browser.
