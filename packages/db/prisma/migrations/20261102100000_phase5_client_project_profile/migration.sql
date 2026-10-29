-- Phase 5: client profile (industry, goals, target locations, account owner) and project
-- goals/settings, plus integrity rules for them.
-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "account_owner_id" TEXT,
ADD COLUMN     "goals" TEXT,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "target_locations" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "goals" TEXT,
ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}';

-- CreateIndex
CREATE INDEX "clients_account_owner_id_idx" ON "clients"("account_owner_id");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_account_owner_id_fkey" FOREIGN KEY ("account_owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---- Integrity rules (CHECK constraints and triggers) ------------------------------------------

ALTER TABLE "clients"
  ADD CONSTRAINT "clients_goals_len_chk" CHECK ("goals" IS NULL OR char_length("goals") <= 4000),
  ADD CONSTRAINT "clients_industry_len_chk" CHECK ("industry" IS NULL OR char_length("industry") <= 120),
  ADD CONSTRAINT "clients_target_locations_chk" CHECK (cardinality("target_locations") <= 25);

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_goals_len_chk" CHECK ("goals" IS NULL OR char_length("goals") <= 4000),
  ADD CONSTRAINT "projects_dates_chk" CHECK ("starts_on" IS NULL OR "ends_on" IS NULL OR "ends_on" >= "starts_on");

-- The account owner must be someone who can work on the client: a platform admin, an active member
-- of the client, or agency staff with all-clients access in the client's agency.
CREATE FUNCTION assert_account_owner_access() RETURNS trigger AS $$
BEGIN
  IF NEW.account_owner_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.account_owner_id AND u.is_admin AND u.deactivated_at IS NULL)
     OR EXISTS (SELECT 1 FROM client_memberships m
                WHERE m.client_id = NEW.id AND m.user_id = NEW.account_owner_id AND m.status = 'active')
     OR EXISTS (SELECT 1 FROM agency_memberships a JOIN users u ON u.id = a.user_id
                WHERE a.agency_id = NEW.agency_id AND a.user_id = NEW.account_owner_id
                  AND a.status = 'active' AND a.all_clients_access AND u.deactivated_at IS NULL)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'account owner % has no access to client %', NEW.account_owner_id, NEW.id USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clients_account_owner_access BEFORE INSERT OR UPDATE OF "account_owner_id" ON "clients"
  FOR EACH ROW EXECUTE FUNCTION assert_account_owner_access();
