-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeliveryStatus" ADD VALUE 'sending';
ALTER TYPE "DeliveryStatus" ADD VALUE 'needs_review';

-- AlterTable
ALTER TABLE "report_deliveries" ADD COLUMN     "next_attempt_at" TIMESTAMPTZ(3),
ADD COLUMN     "request_sent_at" TIMESTAMPTZ(3),
ADD COLUMN     "resend_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "started_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "error" TEXT,
ADD COLUMN     "review_note" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "report_delivery_attempts" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "status" "DeliveryStatus" NOT NULL,
    "error" TEXT,
    "provider_message_id" TEXT,
    "triggered_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_schedules" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "template_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "interval_days" INTEGER NOT NULL DEFAULT 15,
    "anchor_date" DATE NOT NULL,
    "send_hour" INTEGER NOT NULL DEFAULT 9,
    "recipients" TEXT[],
    "deliver_on_approval" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMPTZ(3),
    "last_period_end" DATE,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_delivery_attempts_delivery_id_created_at_idx" ON "report_delivery_attempts"("delivery_id", "created_at");

-- CreateIndex
CREATE INDEX "report_schedules_enabled_next_run_at_idx" ON "report_schedules"("enabled", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "report_schedules_client_id_key" ON "report_schedules"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_schedules_id_client_id_key" ON "report_schedules"("id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_deliveries_id_client_id_key" ON "report_deliveries"("id", "client_id");

-- AddForeignKey
ALTER TABLE "report_delivery_attempts" ADD CONSTRAINT "report_delivery_attempts_client_id_agency_id_fkey" FOREIGN KEY ("client_id", "agency_id") REFERENCES "clients"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_delivery_attempts" ADD CONSTRAINT "report_delivery_attempts_delivery_id_client_id_fkey" FOREIGN KEY ("delivery_id", "client_id") REFERENCES "report_deliveries"("id", "client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_client_id_agency_id_fkey" FOREIGN KEY ("client_id", "agency_id") REFERENCES "clients"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Rules Prisma cannot express ---------------------------------------------------------------

ALTER TABLE "report_schedules"
  ADD CONSTRAINT "report_schedules_interval_chk" CHECK ("interval_days" BETWEEN 1 AND 92),
  ADD CONSTRAINT "report_schedules_hour_chk" CHECK ("send_hour" BETWEEN 0 AND 23),
  ADD CONSTRAINT "report_schedules_recipients_chk" CHECK (cardinality("recipients") <= 20);

-- One report per client, period and revision, whatever the template: a schedule or a double click cannot create it twice.
CREATE UNIQUE INDEX "reports_client_period_revision_uq" ON "reports" ("client_id", "period_start", "period_end", "revision");

-- Recipients are stored lower-case and trimmed, so the one-delivery-per-recipient rule cannot be dodged by letter case.
ALTER TABLE "report_deliveries"
  ADD CONSTRAINT "report_deliveries_recipient_chk" CHECK ("recipient" = lower(btrim("recipient")) AND char_length("recipient") BETWEEN 3 AND 320),
  ADD CONSTRAINT "report_deliveries_counts_chk" CHECK ("attempts" >= 0 AND "resend_count" >= 0);
