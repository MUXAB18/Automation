-- Phase 6: task management. The existing tasks model is extended, not duplicated.
--  * Task statuses become Backlog, Assigned, In progress, Ready for review, Changes requested, Blocked,
--    Approved, Completed, Cancelled. Existing values are RENAMED so rows keep their meaning:
--    todo -> assigned, in_review -> ready_for_review, done -> completed.
--  * New task fields: acceptance criteria, completion evidence, review timestamp, related content item.

ALTER TYPE "TaskStatus" RENAME VALUE 'todo' TO 'assigned';
ALTER TYPE "TaskStatus" RENAME VALUE 'in_review' TO 'ready_for_review';
ALTER TYPE "TaskStatus" RENAME VALUE 'done' TO 'completed';
ALTER TYPE "TaskStatus" ADD VALUE 'changes_requested';
ALTER TYPE "TaskStatus" ADD VALUE 'approved';

ALTER TYPE "TaskEventType" ADD VALUE 'reassigned';
ALTER TYPE "TaskEventType" ADD VALUE 'evidence_submitted';
ALTER TYPE "TaskEventType" ADD VALUE 'time_logged';
ALTER TYPE "TaskEventType" ADD VALUE 'linked';

ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'backlog';

ALTER TABLE "tasks"
  ADD COLUMN "acceptance_criteria" TEXT,
  ADD COLUMN "content_item_id" TEXT,
  ADD COLUMN "evidence_links" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "evidence_note" TEXT,
  ADD COLUMN "review_requested_at" TIMESTAMPTZ(3);

CREATE INDEX "tasks_content_item_id_idx" ON "tasks"("content_item_id");

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_content_item_id_client_id_fkey"
  FOREIGN KEY ("content_item_id", "client_id") REFERENCES "content_items"("id", "client_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- Data fixes so existing rows satisfy the new rules ---------------------------------------------
-- "Assigned" means someone is assigned.
UPDATE "tasks" SET "status" = 'backlog' WHERE "status" = 'assigned' AND "assignee_id" IS NULL;
-- Completed tasks carry a completion time, and only completed tasks do.
UPDATE "tasks" SET "completed_at" = COALESCE("completed_at", "updated_at") WHERE "status" = 'completed';
UPDATE "tasks" SET "completed_at" = NULL WHERE "status" <> 'completed' AND "completed_at" IS NOT NULL;

-- ---- Integrity rules (CHECK constraints) ------------------------------------------------------------
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_completed_at_chk" CHECK (("status" = 'completed') = ("completed_at" IS NOT NULL)),
  ADD CONSTRAINT "tasks_title_len_chk" CHECK (char_length("title") BETWEEN 1 AND 200),
  ADD CONSTRAINT "tasks_description_len_chk" CHECK ("description" IS NULL OR char_length("description") <= 10000),
  ADD CONSTRAINT "tasks_criteria_len_chk" CHECK ("acceptance_criteria" IS NULL OR char_length("acceptance_criteria") <= 4000),
  ADD CONSTRAINT "tasks_evidence_len_chk" CHECK (
    ("evidence_note" IS NULL OR char_length("evidence_note") <= 4000) AND cardinality("evidence_links") <= 10);
