-- Rename the "customer" concept to "client" (a business managed by an agency).
-- Pure rename: data is preserved, nothing is dropped or recreated.

ALTER TYPE "CustomerStatus" RENAME TO "ClientStatus";

ALTER TABLE "customers" RENAME TO "clients";

-- customer_id -> client_id on every table that has it
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'customer_id'
  LOOP
    EXECUTE format('ALTER TABLE %I RENAME COLUMN customer_id TO client_id', r.table_name);
  END LOOP;
END $$;

-- Constraint names (primary keys, uniques, foreign keys) and index names that mention customer
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, c.conname
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.conname LIKE '%customer%'
  LOOP
    EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', r.tbl, r.conname, replace(r.conname, 'customer', 'client'));
  END LOOP;

  FOR r IN
    SELECT i.indexname FROM pg_indexes i
    WHERE i.schemaname = 'public' AND i.indexname LIKE '%customer%'
  LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, replace(r.indexname, 'customer', 'client'));
  END LOOP;
END $$;
