-- CreateEnum
CREATE TYPE "AutomationRuleKind" AS ENUM ('keyword_rank_drop', 'critical_audit_issue', 'page_needs_optimization', 'organic_traffic_drop', 'content_deadline_approaching', 'task_overdue', 'integration_failing');

-- CreateEnum
CREATE TYPE "AutomationFindingStatus" AS ENUM ('open', 'resolved');

-- AlterTable
ALTER TABLE "automation_rules" ADD COLUMN     "assignment" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "config" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "cooldown" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "customized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "due_policy" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "interval_minutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "kind" "AutomationRuleKind",
ADD COLUMN     "notify_policy" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "project_id" TEXT,
ADD COLUMN     "severity" "IssueSeverity" NOT NULL DEFAULT 'medium',
ADD COLUMN     "task_template" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "template_id" TEXT;

-- AlterTable
ALTER TABLE "automation_runs" ADD COLUMN     "next_attempt_at" TIMESTAMPTZ(3),
ADD COLUMN     "summary" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "automation_key" TEXT;

-- CreateTable
CREATE TABLE "automation_rule_templates" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "AutomationRuleKind" NOT NULL,
    "status" "AutomationRuleStatus" NOT NULL DEFAULT 'draft',
    "severity" "IssueSeverity" NOT NULL DEFAULT 'medium',
    "config" JSONB NOT NULL DEFAULT '{}',
    "assignment" JSONB NOT NULL DEFAULT '{}',
    "task_template" JSONB NOT NULL DEFAULT '{}',
    "due_policy" JSONB NOT NULL DEFAULT '{}',
    "notify_policy" JSONB NOT NULL DEFAULT '{}',
    "cooldown" JSONB NOT NULL DEFAULT '{}',
    "interval_minutes" INTEGER NOT NULL DEFAULT 60,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "automation_rule_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_findings" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "rule_id" TEXT,
    "kind" "AutomationRuleKind" NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "status" "AutomationFindingStatus" NOT NULL DEFAULT 'open',
    "severity" "IssueSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "project_id" TEXT,
    "task_id" TEXT,
    "seo_issue_id" TEXT,
    "task_count" INTEGER NOT NULL DEFAULT 0,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "last_notified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "automation_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "automation_rule_templates_agency_id_name_key" ON "automation_rule_templates"("agency_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "automation_rule_templates_id_agency_id_key" ON "automation_rule_templates"("id", "agency_id");

-- CreateIndex
CREATE INDEX "automation_findings_client_id_status_kind_idx" ON "automation_findings"("client_id", "status", "kind");

-- CreateIndex
CREATE INDEX "automation_findings_task_id_idx" ON "automation_findings"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_findings_client_id_dedupe_key_key" ON "automation_findings"("client_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "automation_findings_id_client_id_key" ON "automation_findings"("id", "client_id");

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_project_id_client_id_fkey" FOREIGN KEY ("project_id", "client_id") REFERENCES "projects"("id", "client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_template_id_agency_id_fkey" FOREIGN KEY ("template_id", "agency_id") REFERENCES "automation_rule_templates"("id", "agency_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rule_templates" ADD CONSTRAINT "automation_rule_templates_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_findings" ADD CONSTRAINT "automation_findings_client_id_agency_id_fkey" FOREIGN KEY ("client_id", "agency_id") REFERENCES "clients"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_findings" ADD CONSTRAINT "automation_findings_rule_id_client_id_fkey" FOREIGN KEY ("rule_id", "client_id") REFERENCES "automation_rules"("id", "client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_findings" ADD CONSTRAINT "automation_findings_task_id_client_id_fkey" FOREIGN KEY ("task_id", "client_id") REFERENCES "tasks"("id", "client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_findings" ADD CONSTRAINT "automation_findings_seo_issue_id_client_id_fkey" FOREIGN KEY ("seo_issue_id", "client_id") REFERENCES "seo_issues"("id", "client_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules Prisma cannot express ---------------------------------------------------------------

-- A rule can never create a duplicate: while a task is open, one task per (client, automation key).
CREATE UNIQUE INDEX "tasks_open_automation_key_uq" ON "tasks" ("client_id", "automation_key")
  WHERE "automation_key" IS NOT NULL AND "status" NOT IN ('completed', 'cancelled');
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_automation_key_len_chk"
  CHECK ("automation_key" IS NULL OR char_length("automation_key") BETWEEN 1 AND 300);

-- One queued or running execution per rule: two workers (or a double click) cannot evaluate it at once.
CREATE UNIQUE INDEX "automation_runs_one_active_per_rule_uq" ON "automation_runs" ("rule_id")
  WHERE "status" IN ('queued', 'running');

ALTER TABLE "automation_rules"
  ADD CONSTRAINT "automation_rules_interval_chk" CHECK ("interval_minutes" BETWEEN 5 AND 10080);
ALTER TABLE "automation_rule_templates"
  ADD CONSTRAINT "automation_templates_interval_chk" CHECK ("interval_minutes" BETWEEN 5 AND 10080);

ALTER TABLE "automation_findings"
  ADD CONSTRAINT "automation_findings_counts_chk" CHECK ("occurrences" >= 1 AND "task_count" >= 0),
  ADD CONSTRAINT "automation_findings_key_len_chk" CHECK (char_length("dedupe_key") BETWEEN 1 AND 400),
  ADD CONSTRAINT "automation_findings_resolved_chk" CHECK (("status" = 'resolved') = ("resolved_at" IS NOT NULL));
