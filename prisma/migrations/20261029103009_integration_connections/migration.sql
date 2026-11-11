-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('google');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('active', 'needs_reauth', 'disconnected');

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'active',
    "account_email" TEXT,
    "scopes" TEXT[],
    "encrypted_refresh_token" TEXT NOT NULL,
    "gsc_site_url" TEXT,
    "ga4_property_id" TEXT,
    "connected_by_id" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_customer_id_provider_key" ON "integration_connections"("customer_id", "provider");

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_connected_by_id_fkey" FOREIGN KEY ("connected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
