-- CreateEnum
CREATE TYPE "CrmAutomationKind" AS ENUM ('campaign', 'workflow');

-- AlterEnum
ALTER TYPE "PublishingJobStatus" ADD VALUE 'needs_review';

-- AlterTable
ALTER TABLE "publishing_jobs" ADD COLUMN     "request_sent_at" TIMESTAMPTZ(3),
ADD COLUMN     "target_account_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "crm_contacts" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "integration_account_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "source" TEXT,
    "tags" TEXT[],
    "external_created_at" TIMESTAMPTZ(3),
    "external_updated_at" TIMESTAMPTZ(3),
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_pipelines" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "integration_account_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stages" JSONB NOT NULL DEFAULT '[]',
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_opportunities" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "integration_account_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT,
    "monetary_value" DECIMAL(14,2),
    "pipeline_external_id" TEXT,
    "stage_external_id" TEXT,
    "contact_external_id" TEXT,
    "assigned_to_external_id" TEXT,
    "external_created_at" TIMESTAMPTZ(3),
    "external_updated_at" TIMESTAMPTZ(3),
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_conversations" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "integration_account_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "contact_external_id" TEXT,
    "type" TEXT,
    "last_message_type" TEXT,
    "last_message_at" TIMESTAMPTZ(3),
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_automations" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "integration_account_id" TEXT NOT NULL,
    "kind" "CrmAutomationKind" NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT,
    "version" INTEGER,
    "external_created_at" TIMESTAMPTZ(3),
    "external_updated_at" TIMESTAMPTZ(3),
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_social_accounts" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "integration_account_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "profile_external_id" TEXT,
    "platform" TEXT,
    "name" TEXT,
    "type" TEXT,
    "is_expired" BOOLEAN NOT NULL DEFAULT false,
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_social_posts" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "integration_account_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "platform" TEXT,
    "summary" TEXT,
    "status" TEXT,
    "type" TEXT,
    "account_external_ids" TEXT[],
    "platform_post_id" TEXT,
    "scheduled_for" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "provider_error" TEXT,
    "external_created_at" TIMESTAMPTZ(3),
    "external_updated_at" TIMESTAMPTZ(3),
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_social_stats" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "integration_account_id" TEXT NOT NULL,
    "sync_run_id" TEXT,
    "window_days" INTEGER NOT NULL DEFAULT 7,
    "posts" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "captured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_social_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_contacts_client_id_email_idx" ON "crm_contacts"("client_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "crm_contacts_integration_account_id_external_id_key" ON "crm_contacts"("integration_account_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_contacts_id_client_id_key" ON "crm_contacts"("id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_pipelines_integration_account_id_external_id_key" ON "crm_pipelines"("integration_account_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_pipelines_id_client_id_key" ON "crm_pipelines"("id", "client_id");

-- CreateIndex
CREATE INDEX "crm_opportunities_client_id_status_idx" ON "crm_opportunities"("client_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "crm_opportunities_integration_account_id_external_id_key" ON "crm_opportunities"("integration_account_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_opportunities_id_client_id_key" ON "crm_opportunities"("id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_conversations_integration_account_id_external_id_key" ON "crm_conversations"("integration_account_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_conversations_id_client_id_key" ON "crm_conversations"("id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_automations_integration_account_id_kind_external_id_key" ON "crm_automations"("integration_account_id", "kind", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_automations_id_client_id_key" ON "crm_automations"("id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_social_accounts_integration_account_id_external_id_key" ON "provider_social_accounts"("integration_account_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_social_accounts_id_client_id_key" ON "provider_social_accounts"("id", "client_id");

-- CreateIndex
CREATE INDEX "provider_social_posts_client_id_published_at_idx" ON "provider_social_posts"("client_id", "published_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "provider_social_posts_integration_account_id_external_id_key" ON "provider_social_posts"("integration_account_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_social_posts_id_client_id_key" ON "provider_social_posts"("id", "client_id");

-- CreateIndex
CREATE INDEX "provider_social_stats_integration_account_id_captured_at_idx" ON "provider_social_stats"("integration_account_id", "captured_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "provider_social_stats_sync_run_id_key" ON "provider_social_stats"("sync_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_social_stats_id_client_id_key" ON "provider_social_stats"("id", "client_id");

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_client_id_agency_id_fkey" FOREIGN KEY ("client_id", "agency_id") REFERENCES "clients"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_integration_account_id_client_id_fkey" FOREIGN KEY ("integration_account_id", "client_id") REFERENCES "integration_accounts"("id", "client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_client_id_agency_id_fkey" FOREIGN KEY ("client_id", "agency_id") REFERENCES "clients"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_integration_account_id_client_id_fkey" FOREIGN KEY ("integration_account_id", "client_id") REFERENCES "integration_accounts"("id", "client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_client_id_agency_id_fkey" FOREIGN KEY ("client_id", "agency_id") REFERENCES "clients"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_integration_account_id_client_id_fkey" FOREIGN KEY ("integration_account_id", "client_id") REFERENCES "integration_accounts"("id", "client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_client_id_agency_id_fkey" FOREIGN KEY ("client_id", "agency_id") REFERENCES "clients"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_integration_account_id_client_id_fkey" FOREIGN KEY ("integration_account_id", "client_id") REFERENCES "integration_accounts"("id", "client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_automations" ADD CONSTRAINT "crm_automations_client_id_agency_id_fkey" FOREIGN KEY ("client_id", "agency_id") REFERENCES "clients"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_automations" ADD CONSTRAINT "crm_automations_integration_account_id_client_id_fkey" FOREIGN KEY ("integration_account_id", "client_id") REFERENCES "integration_accounts"("id", "client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_social_accounts" ADD CONSTRAINT "provider_social_accounts_client_id_agency_id_fkey" FOREIGN KEY ("client_id", "agency_id") REFERENCES "clients"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_social_accounts" ADD CONSTRAINT "provider_social_accounts_integration_account_id_client_id_fkey" FOREIGN KEY ("integration_account_id", "client_id") REFERENCES "integration_accounts"("id", "client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_social_posts" ADD CONSTRAINT "provider_social_posts_client_id_agency_id_fkey" FOREIGN KEY ("client_id", "agency_id") REFERENCES "clients"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_social_posts" ADD CONSTRAINT "provider_social_posts_integration_account_id_client_id_fkey" FOREIGN KEY ("integration_account_id", "client_id") REFERENCES "integration_accounts"("id", "client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_social_stats" ADD CONSTRAINT "provider_social_stats_client_id_agency_id_fkey" FOREIGN KEY ("client_id", "agency_id") REFERENCES "clients"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_social_stats" ADD CONSTRAINT "provider_social_stats_integration_account_id_client_id_fkey" FOREIGN KEY ("integration_account_id", "client_id") REFERENCES "integration_accounts"("id", "client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_social_stats" ADD CONSTRAINT "provider_social_stats_sync_run_id_client_id_fkey" FOREIGN KEY ("sync_run_id", "client_id") REFERENCES "sync_runs"("id", "client_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules Prisma cannot express ---------------------------------------------------------------

ALTER TABLE "crm_conversations"
  ADD CONSTRAINT "crm_conversations_unread_chk" CHECK ("unread_count" >= 0);

ALTER TABLE "provider_social_stats"
  ADD CONSTRAINT "provider_social_stats_counts_chk"
  CHECK ("posts" >= 0 AND "likes" >= 0 AND "comments" >= 0 AND "followers" >= 0 AND "impressions" >= 0 AND "window_days" > 0);

ALTER TABLE "provider_social_posts"
  ADD CONSTRAINT "provider_social_posts_error_len_chk" CHECK (char_length("provider_error") <= 500);

-- A job that already sent its request can never go back to "queued": that would allow a second post.
ALTER TABLE "publishing_jobs"
  ADD CONSTRAINT "publishing_jobs_sent_chk" CHECK ("status" <> 'queued' OR "request_sent_at" IS NULL),
  ADD CONSTRAINT "publishing_jobs_targets_chk" CHECK (cardinality("target_account_ids") <= 20);

-- Synced statistics are append-only history, like the other snapshot tables.
CREATE OR REPLACE FUNCTION provider_social_stats_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'provider_social_stats rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER provider_social_stats_no_update
  BEFORE UPDATE ON "provider_social_stats"
  FOR EACH ROW EXECUTE FUNCTION provider_social_stats_immutable();
