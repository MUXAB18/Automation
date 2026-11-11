# Conventions

## Code

- TypeScript strict mode everywhere; no `any` without a comment explaining why.
- Zod for validation at boundaries; derive types from schemas where possible.
- ESM modules. Named exports preferred over default (except Next.js pages).
- Small functions; side effects at the edges; pure logic in `packages/seo` and `packages/reports`.
- Errors: throw typed errors; handle them at the job or request boundary.

## Multi-tenant rules (see CLAUDE.md)

- Data access functions take `customerId` as an explicit first argument or are created via a scoped client.
- Never write per-customer code or branches (`if (customer === ...)`).
- Per-customer variation is data.

## Naming

- Files: `kebab-case.ts`; React components `PascalCase.tsx`.
- DB: `snake_case` tables (plural) and columns; TypeScript: `camelCase`.
- Queues: kebab-case names exactly as in `jobs-and-workflows.md`.
- Env vars: `UPPER_SNAKE_CASE`.

## Git

- Commit messages: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- Small, focused commits; one concern per PR.
- Never commit secrets or `.env`.

## Testing

- Vitest. Unit tests for pure logic (audit rules, rank logic, report builder, crypto).
- Integration tests for data access against a test Postgres, including tenant isolation tests.
- Integrations tested with fixtures/mocks; no live external calls.
- Every new tenant-scoped query gets a cross-tenant test.

## Definition of done (per feature)

- Types, lint and tests pass.
- Tenant scoping verified.
- Approval + change log in place if outward-facing.
- Docs updated (`architecture.md`, `data-model.md`, `decisions.md` as needed).

## Commands

```bash
npm install
npm run dev
npm run build
npm run lint
```

(`test`, `db:migrate`, `db:seed` are added in phase 1.)
