# Product Requirements Document (PRD)

Status: draft v0.1. Nothing described here is built yet except the empty project structure.

## 1. Summary

An internal platform that manages SEO, social media, analytics and reporting for 15+ customers
(businesses) from one dashboard. It automates the loop **Research -> Optimize -> Publish -> Track
-> Report -> Improve**. Humans approve anything that changes a customer's website or publishes
content.

First test customer: **SARJ Worldwide** (sarjworldwide.ca). Other customers are added afterwards
through data only, never through new code.

## 2. Goals

- Run SEO and social work for many customers with one codebase, one database and one set of jobs.
- Cut repetitive work: keyword tracking, audits, content drafting, scheduling, reporting.
- Keep humans in control of every outward-facing change (approval + change log).
- Send each customer a performance report every 15 days automatically.
- Keep every customer's data, websites, accounts and reports fully separate.

## 3. Non-goals (for now)

- A public, self-serve SaaS product. This is internal; customers do not log in (phase 1).
- Billing or invoicing.
- Auto-applying website changes or auto-publishing without approval.
- Per-customer custom workflows or custom code.
- Paid ads management.

## 4. Users and roles

| Role | Who | Can do |
| --- | --- | --- |
| admin | Platform owner | Everything: manage customers, users, integrations, settings, approvals |
| member | Team operator | Work on assigned customers: review, approve, edit content, trigger runs |
| viewer | Read-only (team or later a customer contact) | See dashboards and reports for assigned customers |

Access is per customer through memberships (user + customer + role).

## 5. Functional requirements

### FR1. SEO automation
- Keyword research and per-customer keyword lists.
- Site audits (crawl, rule checks, severity-ranked issues).
- Competitor analysis (tracked competitors per customer).
- Rank tracking with history.
- AI recommendations based on audit, ranking and analytics data.

### FR2. Social media automation
- AI-generated content, captions and hashtags in the customer's brand voice.
- Scheduling and publishing to connected accounts (Meta, LinkedIn first).
- Content lifecycle: draft -> approved -> scheduled -> published.

### FR3. Website optimization
- Detect SEO issues (from audits).
- Propose fixes; **apply only human-approved fixes**.
- Keep a change log of every applied change (what, who approved, when, before/after).

### FR4. Analytics dashboard
- Rankings, traffic, keyword performance, social engagement.
- Per-customer and cross-customer (admin) views.
- Data from Google Search Console, GA4 and social platforms.

### FR5. Automatic reports
- Generate a report per customer every 15 days.
- Email it (PDF/HTML) to the customer's configured report address.
- Store every report for later viewing.

### FR6. Customer management
- Create/pause/archive customers; 15+ supported.
- Per customer: websites, keywords, competitors, brand voice, connected accounts, schedule, report email.
- Fully separated data, websites and reports.

### FR7. Workflow automation
- Routine jobs run on schedules over all active customers.
- Alerts when human review or approval is needed (in-app, email).
- Every job execution is recorded (status, duration, errors).

## 6. Non-functional requirements

- **Multi-tenancy:** `customer_id` on every customer-owned table; every query scoped.
- **Security:** third-party tokens encrypted at rest; role checks on every request; secrets only in env.
- **Reliability:** jobs retry with backoff; failures are visible and alert.
- **Performance:** dashboard pages load fast from stored snapshots; no live crawling in web requests.
- **Auditability:** approvals and website/publishing changes are logged immutably.
- **Operability:** single VPS via Docker Compose; health checks; simple backups.
- **Cost control:** AI and API calls are rate-limited and usage is logged per customer.

## 7. Success metrics

- Time to onboard a new customer: under 1 hour, no code changes.
- Reports delivered on schedule: 100% for active customers (every 15 days).
- Share of AI drafts approved without major edits: tracked per customer.
- Customers' average tracked-keyword position and organic clicks trend up over time.
- Job success rate above 98%; failed jobs alert within minutes.

## 8. Assumptions and open questions

- Customers do not log in during phase 1; reports are emailed.
- Google data access is by OAuth per customer (Search Console, GA4).
- Which rank data source to use (Search Console vs. a paid SERP API) is undecided: see `decisions.md`.
- How website fixes are applied (CMS API, Git PR, manual patch) depends on each customer's stack: to be decided per integration in phase 4.
- Which social networks beyond Meta and LinkedIn are needed.
