-- Phase 4: provenance flag. Development seed rows set is_sample = true so the UI can label
-- them and never mix them up with live provider data. Real rows default to false.
-- AlterTable
ALTER TABLE "content_items" ADD COLUMN     "is_sample" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "keywords" ADD COLUMN     "is_sample" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "is_sample" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "is_sample" BOOLEAN NOT NULL DEFAULT false;

