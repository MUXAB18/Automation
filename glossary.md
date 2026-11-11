# Glossary

- **Customer / tenant:** a business we manage. Row in `customers`.
- **Active customer:** status `active`; the only ones scheduled jobs process.
- **Website:** a domain belonging to a customer.
- **Keyword:** a search term tracked for a customer's website.
- **Ranking:** a recorded search position for a keyword at a point in time.
- **Audit:** one crawl-and-check run of a website; produces audit issues.
- **Audit issue:** a finding with rule, severity and URL.
- **Content item:** a piece of social or site content with a lifecycle status.
- **Post:** a content item published (or scheduled) to a social account.
- **Approval:** a human decision (approve/reject) on a proposed change or content.
- **Change log:** immutable record of an applied website change.
- **Job run:** one execution of a background job, logged in `job_runs`.
- **Queue:** a named BullMQ work queue (e.g. `rank-check`).
- **Snapshot:** a stored daily metrics record from an analytics source.
- **Report:** the 15-day performance document sent to a customer.
- **Brand voice:** per-customer writing style settings used by AI.
- **GSC:** Google Search Console. **GA4:** Google Analytics 4.
