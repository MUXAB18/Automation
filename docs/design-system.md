# Design system and application layout (Phase 4)

A restrained SaaS look: neutral surfaces, one indigo accent, generous spacing, 8 px radius scale, soft single-layer shadows.
Built with Next.js App Router, TypeScript, Tailwind CSS 4, **shadcn/ui** (new-york style, Radix primitives) and Lucide icons.

## Layout

```
┌────────────┬───────────────────────────────────────────────────────────────┐
│ Sidebar    │ Top bar:  ☰ (mobile)  [Client ▾] [Project ▾]      🔔   (JD) ▾ │
│ (≥ lg)     ├───────────────────────────────────────────────────────────────┤
│ grouped    │ main#main     Breadcrumbs                                     │
│ sections   │               Page header  (title · badges · actions)         │
│ Preview    │               Filter bar   (search · selects · toggles)        │
│ tags       │               Content: stat cards / data table / empty state   │
│            │               Pagination                                       │
└────────────┴───────────────────────────────────────────────────────────────┘
```

* **Sidebar** (`components/app/app-sidebar.tsx`): four groups (Workspace, Marketing, Automation, Admin). Below `lg` it becomes a slide-over sheet opened by the ☰ button and closes when you pick a page. Sections still being built carry a **Preview** tag.
* **Top bar** (`app/(dashboard)/layout.tsx`): sticky, with the **client and project selector**, **notifications** and the **profile menu** (settings, light/dark/system theme, sign out).
* **Breadcrumbs** (`components/app/breadcrumbs.tsx`): rendered by `PageHeader`; Overview › Section › Page.
* A "Skip to content" link, landmarks (`nav`, `main`, `search`), visible focus rings and `aria-current` on the active item are built in.

## Navigation

Visibility is computed on the server from the user's real permissions (`lib/sections.ts`); every page repeats the check (`requireSection`) and the layout answers a **real HTTP 404** before anything streams. Editing the menu in dev tools grants nothing.

| Section | Path | Needs | Status | What the page does today |
| --- | --- | --- | --- | --- |
| Overview | `/` | everyone | Live | Counts, needs-attention list, my tasks, coming up, recent activity from the database |
| Clients | `/clients` | `client.view` | Live | List, create, edit, pause/archive, websites, activity |
| Projects | `/projects` | `client.view` | Preview | Read-only list; client users see only projects they belong to |
| Tasks | `/tasks` | `task.view` | Preview | Read-only list with search, status/priority filters, "assigned to me" |
| SEO | `/seo` | `seo.view` | Preview | Keywords with latest rank, open issues, audits; read-only |
| Content Calendar | `/content` | `content.view` | Preview | Read-only list in date order with status filter |
| Social Publishing | `/social` | `content.view` | Preview | Publishing queue and published posts; no accounts can be connected yet |
| Analytics | `/analytics` | `analytics.view` | Preview | Data sources and stored readings; empty until a provider syncs |
| Reports | `/reports` | `report.view` | Preview | Read-only list of reports |
| Automation Rules | `/automation` | `automation.manage` | Preview | Read-only list of rules |
| Integrations | `/integrations` | `integration.manage` | Preview | Provider catalogue and connected accounts (status only, never credentials) |
| Team | `/team` | `agency.members` | Live | Invitations, roles, removal (Phase 3) |
| Settings | `/settings` | everyone | Live | Account, theme, your access |

"Preview" pages read real rows from the database and carry an **Under development** notice saying exactly what is missing. There are no buttons that pretend to work: if a control is on the page, it does something.

## Sample data vs live provider data

* Development seed rows are flagged `is_sample = true` (projects, tasks, keywords, content items) and the seed marks the sample notification in its payload.
* Rows show a blue **Sample** chip and the page shows a **Development sample data** banner. Nothing is ever labelled live unless a provider produced it: keyword ranks show their source (e.g. *Search Console*) in green; with no provider connected they read **No data yet**.
* Real rows default to `is_sample = false`. Production seeds create no sample data (`NODE_ENV=production`).
* Third-party integrations are not implemented: Integrations, Analytics and Social Publishing say so and show empty states.

## Components

| Need | Component | File |
| --- | --- | --- |
| Page title, description, badges, actions, breadcrumbs | `PageHeader`, `Breadcrumbs` | `components/page-header.tsx`, `components/app/breadcrumbs.tsx` |
| Headline numbers | `StatCard` | `components/stat-card.tsx` |
| Search and filters (state lives in the URL, debounced, resets paging) | `FilterBar`, `SearchInput`, `FilterSelect`, `FilterToggle`, `ClearFilters` | `components/filters.tsx` |
| Tables (server-rendered, captioned, responsive columns) | `DataTable`, `dash`, `formatDate` | `components/data-table.tsx` |
| Paging (plain links, works without JS) | `Pagination` | `components/pagination.tsx` |
| Status colours (one map for every status in the app) | `StatusBadge kind="task" status="blocked"` | `components/status-badge.tsx` |
| Confirmation dialogs (accessible alert dialog, runs a server action, shows a toast) | `ConfirmDialog` | `components/confirm-dialog.tsx` |
| Form fields with hint and validation message (aria-describedby, aria-invalid, live region) | `FormField`, `FieldError`, `FormMessage` | `components/form-field.tsx`, `components/form-message.tsx` |
| Toasts | `Toaster` (root layout), `toast()`, `useActionToast`, `useFormToast` | `components/ui/sonner.tsx`, `hooks/` |
| Loading skeletons | `PageSkeleton`, `TableSkeleton`, `StatCardsSkeleton`; `app/(dashboard)/loading.tsx` | `components/skeletons.tsx` |
| Empty / error / not-found | `EmptyState`, `ErrorState`; `error.tsx`, `not-found.tsx` | `components/states.tsx` |
| Under development / sample markers | `DevelopmentNotice`, `SampleBadge`, `SampleBanner` | `components/states.tsx` |
| Primitives from shadcn/ui | button, badge, card, input, label, dialog, alert-dialog, sheet, popover, dropdown-menu, tooltip, table, avatar, skeleton, separator, scroll-area, sonner | `components/ui/` |

`components.json` is configured, so `pnpm dlx shadcn@latest add <component>` works. (The CLI imports `cn` from `"cn"` by mistake in this setup; change it to `@/lib/utils`.) `button.tsx` and `badge.tsx` are customised and must not be overwritten.

### Tokens

Semantic OKLCH variables in `app/globals.css` (`--background`, `--card`, `--muted`, `--primary`, `--accent`, `--destructive`, `--success`, `--warning`, `--info`, `--border`, `--ring`, ...) mapped to Tailwind colours in `@theme inline`. Light and dark are defined together; **theme** follows the OS unless the profile menu sets a cookie that adds `data-theme="light|dark"` to `<html>` on the server (no flash, no script).

## Loading, empty and error states

* **Loading**: `loading.tsx` shows a skeleton while a section streams in (announced to screen readers as "Loading").
* **Empty**: every list distinguishes "nothing here yet" from "nothing matches your filters", and offers a real next step only when one exists.
* **Error**: `error.tsx` catches failures in any section, shows a generic message with a reference id and a **Try again** button; details stay in the server log.

## Data access for the section pages

`packages/db/src/services/workspace.ts` holds the read models. Each one (1) finds the clients where the user holds **that section's permission**, (2) intersects with the header's client/project selection (an id they may not use returns nothing), (3) queries through the scoped client, and (4) limits users whose only role is *Client* to projects they belong to. Covered by `workspace.test.ts` (cross-tenant ids, per-client roles, client users, paging, credentials never selected).

## Adding a section

1. Add it to `lib/nav.ts` (permission, status) and an icon in `app-sidebar.tsx`.
2. Add a read model to `workspace.ts` (+ tests) that starts with `resolve(actor, permission, selection)`.
3. Page: `requireActor()` → `requireSection(actor, key)` → `getScope(actor)` → data → `PageHeader` / `FilterBar` / `DataTable` / `EmptyState`.
4. Add a `DevelopmentNotice` until every control on it works.

## Not done in this phase

No create/edit forms for projects, tasks, content, rules or reports; no charts (nothing to chart yet); no global command search; browser (visual) review was not possible in this environment, so verify the look on your machine.
