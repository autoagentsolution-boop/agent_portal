-- T4: per-user OAuth tokens. The token store goes from one-row-per-platform to
-- one-row-per-(owner, platform). Live DAIS rows are migrated onto the deterministic
-- system owner (seeded in T1) so nothing breaks. Whole migration runs in one
-- transaction (Prisma) → reversible; back up mkt_oauth_token rows first (done).
--
-- Sequence: add owner_id nullable → back-fill system owner → drop old single-col
-- PK → set NOT NULL → composite PK → index + FK.

ALTER TABLE "mkt_oauth_token" ADD COLUMN "owner_id" UUID;

UPDATE "mkt_oauth_token"
SET "owner_id" = '00000000-0000-0000-0000-000000000001'
WHERE "owner_id" IS NULL;

ALTER TABLE "mkt_oauth_token" DROP CONSTRAINT "mkt_oauth_token_pkey";

ALTER TABLE "mkt_oauth_token" ALTER COLUMN "owner_id" SET NOT NULL;

ALTER TABLE "mkt_oauth_token"
  ADD CONSTRAINT "mkt_oauth_token_pkey" PRIMARY KEY ("owner_id", "platform");

CREATE INDEX "ix_token_owner" ON "mkt_oauth_token"("owner_id");

ALTER TABLE "mkt_oauth_token" ADD CONSTRAINT "mkt_oauth_token_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "mkt_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
