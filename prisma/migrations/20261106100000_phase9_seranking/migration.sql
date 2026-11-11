-- AlterEnum
ALTER TYPE "BacklinkSource" ADD VALUE 'se_ranking';

-- AlterEnum
ALTER TYPE "RankSource" ADD VALUE 'se_ranking';

-- AlterTable
ALTER TABLE "competitors" ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "external_source" TEXT,
ADD COLUMN     "provider_data" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "keywords" ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "external_source" TEXT,
ADD COLUMN     "search_volume" INTEGER,
ADD COLUMN     "volume_updated_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "seo_issues" ADD COLUMN     "external_source" TEXT;

-- AlterTable
ALTER TABLE "site_audits" ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "external_source" TEXT;

-- CreateTable
CREATE TABLE "provider_seo_projects" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "integration_account_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT,
    "title" TEXT,
    "provider_active" BOOLEAN NOT NULL DEFAULT true,
    "keyword_count" INTEGER,
    "engines" JSONB NOT NULL DEFAULT '[]',
    "site_engine_id" INTEGER,
    "seo_project_id" TEXT,
    "sync_enabled" BOOLEAN NOT NULL DEFAULT false,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "summary_at" TIMESTAMPTZ(3),
    "rankings_through" DATE,
    "linked_by_id" TEXT,
    "linked_at" TIMESTAMPTZ(3),
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_seo_projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_seo_projects_client_id_idx" ON "provider_seo_projects"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_seo_projects_integration_account_id_external_id_key" ON "provider_seo_projects"("integration_account_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_seo_projects_seo_project_id_client_id_key" ON "provider_seo_projects"("seo_project_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_seo_projects_id_client_id_key" ON "provider_seo_projects"("id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "competitors_seo_project_id_external_source_external_id_key" ON "competitors"("seo_project_id", "external_source", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "keywords_seo_project_id_external_source_external_id_key" ON "keywords"("seo_project_id", "external_source", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_audits_seo_project_id_external_source_external_id_key" ON "site_audits"("seo_project_id", "external_source", "external_id");

-- AddForeignKey
ALTER TABLE "provider_seo_projects" ADD CONSTRAINT "provider_seo_projects_client_id_agency_id_fkey" FOREIGN KEY ("client_id", "agency_id") REFERENCES "clients"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_seo_projects" ADD CONSTRAINT "provider_seo_projects_integration_account_id_client_id_fkey" FOREIGN KEY ("integration_account_id", "client_id") REFERENCES "integration_accounts"("id", "client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_seo_projects" ADD CONSTRAINT "provider_seo_projects_seo_project_id_client_id_fkey" FOREIGN KEY ("seo_project_id", "client_id") REFERENCES "seo_projects"("id", "client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_seo_projects" ADD CONSTRAINT "provider_seo_projects_linked_by_id_fkey" FOREIGN KEY ("linked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Rules Prisma cannot express ---------------------------------------------------------------

-- A project can only be synced once it is linked to a platform SEO project and a search engine is chosen.
ALTER TABLE "provider_seo_projects"
  ADD CONSTRAINT "provider_seo_projects_sync_chk"
  CHECK ("sync_enabled" = false OR ("seo_project_id" IS NOT NULL AND "site_engine_id" IS NOT NULL));

-- Provider identity columns come in pairs.
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_external_pair_chk"
  CHECK (("external_source" IS NULL) = ("external_id" IS NULL));
ALTER TABLE "site_audits" ADD CONSTRAINT "site_audits_external_pair_chk"
  CHECK (("external_source" IS NULL) = ("external_id" IS NULL));
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_external_pair_chk"
  CHECK (("external_source" IS NULL) = ("external_id" IS NULL));

ALTER TABLE "keywords" ADD CONSTRAINT "keywords_volume_chk" CHECK ("search_volume" IS NULL OR "search_volume" >= 0);
