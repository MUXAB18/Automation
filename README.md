# SEO & Social Media Automation

Internal platform that manages 15+ customers (businesses) from one dashboard: SEO
automation, social media automation, analytics and automatic reports. First test
customer: SARJ Worldwide (sarjworldwide.ca).

## Folder guide

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js dashboard (App Router, Tailwind) |
| `apps/worker` | Node.js background worker (BullMQ + Redis later) |
| `packages/db` | Schema and migrations |
| `packages/integrations` | claude, google-search-console, ga4, meta, linkedin, email |
| `packages/seo` | crawler, audits, keywords, rankings |
| `packages/reports` | Report generation |
| `packages/config` | Shared tsconfig and eslint config |
| `docker` | Compose and Caddy (placeholders) |
| `docs` | Architecture and decisions |

See `CLAUDE.md` for the design rules.

## Run locally

```bash
pnpm install
cp .env.example .env
pnpm dev   # web on http://localhost:3000, worker logs "worker started"
```
