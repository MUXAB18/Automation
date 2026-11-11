-- Phase 3: multiple roles per membership, the seven product roles, and invitations.
--  * agency_memberships.role_id / client_memberships.role_id become agency_membership_roles /
--    client_membership_roles (a user may hold several roles; permissions are the union).
--  * The Phase 2 placeholder roles (owner/admin/member/viewer) are replaced by Agency Admin,
--    SEO Manager, SEO Specialist, Content Writer, Social Media Manager, Reviewer and Client.
--    Existing memberships are mapped: owner/admin -> agency_admin, agency member -> reviewer;
--    client admin -> seo_manager, member -> seo_specialist, viewer -> reviewer.
--  * Role -> permission links are filled by the application (`pnpm db:seed` runs syncRbac).

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- CreateTable
CREATE TABLE "agency_membership_roles" (
    "agency_id" TEXT NOT NULL,
    "agency_membership_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_membership_roles_pkey" PRIMARY KEY ("agency_membership_id","role_id")
);

-- CreateTable
CREATE TABLE "client_membership_roles" (
    "agency_id" TEXT NOT NULL,
    "client_membership_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_membership_roles_pkey" PRIMARY KEY ("client_membership_id","role_id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "client_id" TEXT,
    "email" TEXT NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "all_clients_access" BOOLEAN NOT NULL DEFAULT false,
    "invited_by_id" TEXT,
    "accepted_by_id" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation_roles" (
    "agency_id" TEXT NOT NULL,
    "invitation_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,

    CONSTRAINT "invitation_roles_pkey" PRIMARY KEY ("invitation_id","role_id")
);

-- CreateIndex
CREATE INDEX "agency_membership_roles_role_id_idx" ON "agency_membership_roles"("role_id");

-- CreateIndex
CREATE INDEX "client_membership_roles_role_id_idx" ON "client_membership_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_agency_id_status_idx" ON "invitations"("agency_id", "status");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_id_agency_id_key" ON "invitations"("id", "agency_id");

-- CreateIndex
CREATE INDEX "invitation_roles_role_id_idx" ON "invitation_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "agency_memberships_id_agency_id_key" ON "agency_memberships"("id", "agency_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_memberships_id_agency_id_key" ON "client_memberships"("id", "agency_id");

-- The single-role scope triggers are replaced by one on the new link table (below).
DROP TRIGGER agency_memberships_role_scope ON "agency_memberships";
DROP TRIGGER client_memberships_role_scope ON "client_memberships";
DROP FUNCTION assert_role_scope();

-- ---- Data migration: roles ------------------------------------------------------------------
INSERT INTO roles (id, agency_id, scope, key, name, is_system, updated_at)
SELECT gen_random_uuid()::text, a.id, v.scope::"RoleScope", v.key, v.name, true, now()
FROM agencies a
CROSS JOIN (VALUES
  ('agency', 'agency_admin', 'Agency Admin'),
  ('agency', 'seo_manager', 'SEO Manager'),
  ('agency', 'seo_specialist', 'SEO Specialist'),
  ('agency', 'content_writer', 'Content Writer'),
  ('agency', 'social_media_manager', 'Social Media Manager'),
  ('agency', 'reviewer', 'Reviewer'),
  ('client', 'client', 'Client')
) AS v(scope, key, name);

INSERT INTO agency_membership_roles (agency_id, agency_membership_id, role_id)
SELECT m.agency_id, m.id, nr.id
FROM agency_memberships m
JOIN roles o ON o.id = m.role_id
JOIN roles nr ON nr.agency_id = m.agency_id AND nr.scope = 'agency'
 AND nr.key = CASE WHEN o.key IN ('owner', 'admin') THEN 'agency_admin' ELSE 'reviewer' END;

INSERT INTO client_membership_roles (agency_id, client_membership_id, role_id)
SELECT m.agency_id, m.id, nr.id
FROM client_memberships m
JOIN roles o ON o.id = m.role_id
JOIN roles nr ON nr.agency_id = m.agency_id AND nr.scope = 'agency'
 AND nr.key = CASE o.key WHEN 'admin' THEN 'seo_manager' WHEN 'member' THEN 'seo_specialist' ELSE 'reviewer' END;

-- DropForeignKey
ALTER TABLE "agency_memberships" DROP CONSTRAINT "agency_memberships_role_id_agency_id_fkey";

-- DropForeignKey
ALTER TABLE "client_memberships" DROP CONSTRAINT "client_memberships_role_id_agency_id_fkey";

-- DropIndex
DROP INDEX "agency_memberships_role_id_idx";

-- DropIndex
DROP INDEX "client_memberships_role_id_idx";

-- AlterTable
ALTER TABLE "agency_memberships" DROP COLUMN "role_id";

-- AlterTable
ALTER TABLE "client_memberships" DROP COLUMN "role_id";

-- The placeholder roles are no longer referenced by any membership.
DELETE FROM roles WHERE key IN ('owner', 'admin', 'member', 'viewer');

-- AddForeignKey
ALTER TABLE "agency_membership_roles" ADD CONSTRAINT "agency_membership_roles_agency_membership_id_agency_id_fkey" FOREIGN KEY ("agency_membership_id", "agency_id") REFERENCES "agency_memberships"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_membership_roles" ADD CONSTRAINT "agency_membership_roles_role_id_agency_id_fkey" FOREIGN KEY ("role_id", "agency_id") REFERENCES "roles"("id", "agency_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_membership_roles" ADD CONSTRAINT "client_membership_roles_client_membership_id_agency_id_fkey" FOREIGN KEY ("client_membership_id", "agency_id") REFERENCES "client_memberships"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_membership_roles" ADD CONSTRAINT "client_membership_roles_role_id_agency_id_fkey" FOREIGN KEY ("role_id", "agency_id") REFERENCES "roles"("id", "agency_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_client_id_agency_id_fkey" FOREIGN KEY ("client_id", "agency_id") REFERENCES "clients"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_id_fkey" FOREIGN KEY ("accepted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_roles" ADD CONSTRAINT "invitation_roles_invitation_id_agency_id_fkey" FOREIGN KEY ("invitation_id", "agency_id") REFERENCES "invitations"("id", "agency_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_roles" ADD CONSTRAINT "invitation_roles_role_id_agency_id_fkey" FOREIGN KEY ("role_id", "agency_id") REFERENCES "roles"("id", "agency_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---- Integrity rules (CHECK constraints and triggers) ------------------------------------------

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_email_lower_chk" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "invitations_token_hash_chk" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "invitations_expiry_chk" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "invitations_accepted_chk" CHECK ("status" <> 'accepted' OR ("accepted_at" IS NOT NULL));

-- Agency seats may only carry agency-scope roles.
CREATE FUNCTION assert_agency_role_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM roles r WHERE r.id = NEW.role_id AND r.scope = 'agency') THEN
    RAISE EXCEPTION 'only agency-scope roles can be held at agency level' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agency_membership_roles_scope BEFORE INSERT OR UPDATE ON "agency_membership_roles"
  FOR EACH ROW EXECUTE FUNCTION assert_agency_role_scope();

-- A client-scope role (the external "Client" role) can only be offered for one specific client.
CREATE FUNCTION assert_invitation_role() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM roles r JOIN invitations i ON i.id = NEW.invitation_id
        WHERE r.id = NEW.role_id AND r.scope = 'client' AND i.client_id IS NULL) THEN
    RAISE EXCEPTION 'the client role can only be granted through a client-specific invitation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invitation_roles_scope BEFORE INSERT OR UPDATE ON "invitation_roles"
  FOR EACH ROW EXECUTE FUNCTION assert_invitation_role();
