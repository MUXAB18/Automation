# @automation/db

Tenant-scoped data access (Prisma client, services, authorization). The Prisma **schema, migrations and seed
live in the repo-root [`prisma/`](../../prisma) folder**, configured by `prisma.config.ts`. The generated client
is written to `packages/db/src/generated` (git-ignored).

```bash
npm run db:validate   # check the schema
npm run db:migrate    # create and apply a migration in development
npm run db:deploy     # apply pending migrations (CI, production)
npm run db:status     # which migrations are applied
npm run db:generate   # regenerate the client
npm run db:seed       # reference data, roles, first admin, sample data
```

Constraints Prisma cannot express in the schema (CHECKs, partial unique indexes, triggers) are written as SQL
inside the migration that introduces them, so a fresh `db:deploy` reproduces the full database.
