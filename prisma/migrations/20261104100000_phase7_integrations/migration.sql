-- Phase 7: integration framework.
--  * CRM category (GoHighLevel).
--  * At most one queued/running sync per account, enforced by the database so two workers (or a
--    double click) can never run the same account's sync at once.
--  * Sync errors keep only short, safe text.

ALTER TYPE "IntegrationCategory" ADD VALUE IF NOT EXISTS 'crm';

CREATE UNIQUE INDEX "sync_runs_one_active_per_account"
  ON "sync_runs" ("integration_account_id")
  WHERE "status" IN ('queued', 'running');

ALTER TABLE "sync_errors"
  ADD CONSTRAINT "sync_errors_message_len_chk" CHECK (char_length("message") <= 500),
  ADD CONSTRAINT "sync_errors_code_len_chk" CHECK (char_length("code") <= 64);
