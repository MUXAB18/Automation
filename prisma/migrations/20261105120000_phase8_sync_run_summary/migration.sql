-- AlterTable
ALTER TABLE "sync_runs" ADD COLUMN     "summary" JSONB NOT NULL DEFAULT '{}';

