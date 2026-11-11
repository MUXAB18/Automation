-- CreateEnum
CREATE TYPE "AiReviewOutcome" AS ENUM ('accepted', 'needs_work', 'rejected');

-- CreateEnum
CREATE TYPE "ApprovalStage" AS ENUM ('internal', 'client');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ContentStatus" ADD VALUE 'idea';
ALTER TYPE "ContentStatus" ADD VALUE 'brief';
ALTER TYPE "ContentStatus" ADD VALUE 'client_approval';
ALTER TYPE "ContentStatus" ADD VALUE 'rejected';
ALTER TYPE "ContentStatus" ADD VALUE 'cancelled';

-- AlterTable
ALTER TABLE "ai_jobs" ADD COLUMN     "content_item_id" TEXT,
ADD COLUMN     "estimated_cost_micros" BIGINT,
ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "input_refs" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "input_tokens" INTEGER,
ADD COLUMN     "next_attempt_at" TIMESTAMPTZ(3),
ADD COLUMN     "output_tokens" INTEGER,
ADD COLUMN     "parent_job_id" TEXT,
ADD COLUMN     "project_id" TEXT,
ADD COLUMN     "review_outcome" "AiReviewOutcome",
ADD COLUMN     "reviewed_at" TIMESTAMPTZ(3),
ADD COLUMN     "reviewed_by_id" TEXT,
ADD COLUMN     "reviewer_feedback" TEXT,
ADD COLUMN     "task" TEXT NOT NULL DEFAULT 'other';

-- AlterTable
ALTER TABLE "content_approvals" ADD COLUMN     "stage" "ApprovalStage" NOT NULL DEFAULT 'internal';

-- AlterTable
ALTER TABLE "content_items" ADD COLUMN     "brief" TEXT,
ADD COLUMN     "requires_client_approval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scheduled_timezone" TEXT;

-- CreateTable
CREATE TABLE "ai_approved_sources" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "project_id" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source_url" TEXT,
    "approved_by_id" TEXT NOT NULL,
    "approved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_approved_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_limits" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "monthly_requests" INTEGER NOT NULL,
    "monthly_cost_micros" BIGINT NOT NULL DEFAULT 0,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_comments" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "content_item_id" TEXT NOT NULL,
    "content_version_id" TEXT,
    "author_id" TEXT,
    "body" TEXT NOT NULL,
    "is_change_request" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_status_events" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "content_item_id" TEXT NOT NULL,
    "from_status" "ContentStatus",
    "to_status" "ContentStatus" NOT NULL,
    "actor_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_publications" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "content_item_id" TEXT NOT NULL,
    "content_version_id" TEXT NOT NULL,
    "published_url" TEXT,
    "published_at" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "marked_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_approved_sources_client_id_archived_at_idx" ON "ai_approved_sources"("client_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_approved_sources_id_client_id_key" ON "ai_approved_sources"("id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_limits_client_id_key" ON "ai_limits"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_limits_id_client_id_key" ON "ai_limits"("id", "client_id");

-- CreateIndex
CREATE INDEX "content_comments_content_item_id_created_at_idx" ON "content_comments"("content_item_id", "created_at");

-- CreateIndex
CREATE INDEX "content_status_events_content_item_id_created_at_idx" ON "content_status_events"("content_item_id", "created_at");

-- CreateIndex
CREATE INDEX "manual_publications_client_id_published_at_idx" ON "manual_publications"("client_id", "published_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "manual_publications_content_version_id_key" ON "manual_publications"("content_version_id");

-- CreateIndex
CREATE INDEX "ai_jobs_status_next_attempt_at_idx" ON "ai_jobs"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_jobs_client_id_idempotency_key_key" ON "ai_jobs"("client_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_project_id_client_id_fkey" FOREIGN KEY ("project_id", "client_id") REFERENCES "projects"("id", "client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_content_item_id_client_id_fkey" FOREIGN KEY ("content_item_id", "client_id") REFERENCES "content_items"("id", "client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_parent_job_id_client_id_fkey" FOREIGN KEY ("parent_job_id", "client_id") REFERENCES "ai_jobs"("id", "client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approved_sources" ADD CONSTRAINT "ai_approved_sources_client_id_agency_id_fkey" FOREIGN KEY ("client_id", "agency_id") REFERENCES "clients"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approved_sources" ADD CONSTRAINT "ai_approved_sources_project_id_client_id_fkey" FOREIGN KEY ("project_id", "client_id") REFERENCES "projects"("id", "client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approved_sources" ADD CONSTRAINT "ai_approved_sources_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_limits" ADD CONSTRAINT "ai_limits_client_id_agency_id_fkey" FOREIGN KEY ("client_id", "agency_id") REFERENCES "clients"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_comments" ADD CONSTRAINT "content_comments_client_id_agency_id_fkey" FOREIGN KEY ("client_id", "agency_id") REFERENCES "clients"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_comments" ADD CONSTRAINT "content_comments_content_item_id_client_id_fkey" FOREIGN KEY ("content_item_id", "client_id") REFERENCES "content_items"("id", "client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_comments" ADD CONSTRAINT "content_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_status_events" ADD CONSTRAINT "content_status_events_client_id_agency_id_fkey" FOREIGN KEY ("client_id", "agency_id") REFERENCES "clients"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_status_events" ADD CONSTRAINT "content_status_events_content_item_id_client_id_fkey" FOREIGN KEY ("content_item_id", "client_id") REFERENCES "content_items"("id", "client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_status_events" ADD CONSTRAINT "content_status_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_publications" ADD CONSTRAINT "manual_publications_client_id_agency_id_fkey" FOREIGN KEY ("client_id", "agency_id") REFERENCES "clients"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_publications" ADD CONSTRAINT "manual_publications_content_item_id_client_id_fkey" FOREIGN KEY ("content_item_id", "client_id") REFERENCES "content_items"("id", "client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_publications" ADD CONSTRAINT "manual_publications_marked_by_id_fkey" FOREIGN KEY ("marked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Rules Prisma cannot express ---------------------------------------------------------------

ALTER TABLE "ai_jobs"
  ADD CONSTRAINT "ai_jobs_counts_chk" CHECK ("attempt" >= 1 AND COALESCE("input_tokens", 0) >= 0 AND COALESCE("output_tokens", 0) >= 0 AND COALESCE("estimated_cost_micros", 0) >= 0),
  ADD CONSTRAINT "ai_jobs_review_chk" CHECK (("review_outcome" IS NULL) = ("reviewed_at" IS NULL)),
  ADD CONSTRAINT "ai_jobs_key_len_chk" CHECK ("idempotency_key" IS NULL OR char_length("idempotency_key") BETWEEN 1 AND 200);
-- Output is stored only for a job that finished successfully.
ALTER TABLE "ai_jobs"
  ADD CONSTRAINT "ai_jobs_output_chk" CHECK ("output" IS NULL OR "status" = 'succeeded');

ALTER TABLE "ai_approved_sources"
  ADD CONSTRAINT "ai_sources_body_chk" CHECK (char_length("body") BETWEEN 1 AND 20000 AND char_length("title") BETWEEN 1 AND 200);

ALTER TABLE "ai_limits"
  ADD CONSTRAINT "ai_limits_chk" CHECK ("monthly_requests" >= 0 AND "monthly_cost_micros" >= 0);

-- A comment or status event is a record: it is never edited or deleted (clients cascade on purpose).
ALTER TABLE "content_comments" ADD CONSTRAINT "content_comments_body_chk" CHECK (char_length("body") BETWEEN 1 AND 4000);
