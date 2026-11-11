# Security

## Principles

- Least privilege, defense in depth, fail closed.
- Customer data isolation is the top security property.

## Tenant isolation

- Every tenant table has `customer_id`; all queries are scoped (see `architecture.md`).
- Web requests verify a membership for the target customer before reading or writing.
- Jobs carry `customerId` and use scoped data access.
- Tests must prove customer A cannot read or write customer B's rows.

## Authentication and authorization

- Session-based auth; secure, HttpOnly, SameSite cookies; sessions expire.
- Roles per customer: admin, member, viewer. Enforce on the server for every action, never only in the UI.
- No public sign-up; admins create users.
- Rate-limit login; lock or delay after repeated failures.

## Secrets and tokens

- Third-party tokens (Google, Meta, LinkedIn) are encrypted at rest with AES-256-GCM.
- `ENCRYPTION_KEY` comes from the environment, never the database or git. Support key rotation (store a key id with each ciphertext).
- Decrypt only in the worker or server code that needs it; never send tokens to the browser or logs.
- `.env` is git-ignored; `.env.example` has placeholders only.
- Request minimum OAuth scopes (read-only where possible).

## Outward-facing actions

- Website changes and publishing require an approved approval and write a `change_log` entry.
- Handlers re-check approval status immediately before executing.
- Change log and approvals are append-only.

## Input and output safety

- Validate all input with Zod at every boundary (forms, API, job payloads, AI output).
- Treat AI output and crawled web content as untrusted: never execute it, sanitize before rendering, and never let it change prompts or permissions.
- Escape output; use parameterized queries only.
- Crawler: restrict to the customer's verified domains; respect timeouts and size limits; block internal IP ranges (SSRF protection).

## Infrastructure

- HTTPS only via Caddy; HSTS.
- Postgres and Redis not exposed publicly; Docker internal network only; Redis requires a password.
- Containers run as non-root; pinned image versions.
- Firewall: only 80/443 (and SSH with keys) open.
- Automated encrypted backups of Postgres; periodic restore test.

## Logging and privacy

- Structured logs without secrets, tokens or full personal data.
- Keep customer data only as long as needed; archive instead of deleting by default.
- Record AI usage per customer for cost and audit.

## Review checklist (each phase)

- New table has `customer_id` and indexes?
- New query scoped by customer?
- New token stored encrypted?
- New outward action behind approval + change log?
- New input validated with Zod?
