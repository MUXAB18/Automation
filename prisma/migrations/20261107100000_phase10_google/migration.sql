-- AlterTable
ALTER TABLE "analytics_sources" ADD COLUMN     "data_through" DATE,
ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}';


-- Source metadata is always a JSON object.
ALTER TABLE "analytics_sources" ADD CONSTRAINT "analytics_sources_meta_obj_chk" CHECK (jsonb_typeof("metadata") = 'object');
