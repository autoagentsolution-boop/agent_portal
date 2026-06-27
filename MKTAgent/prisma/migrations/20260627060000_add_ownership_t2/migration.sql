-- T2: ownership. Denormalizes owner_id onto mkt_post, adds owner_id to mkt_lead
-- (NOT NULL) and mkt_run_log (nullable audit). Existing single-tenant rows are
-- back-filled onto the deterministic system/DAIS owner (seeded in T1) so live
-- DAIS data is preserved. Each column is added nullable, back-filled, then locked
-- (Prisma wraps the migration in one transaction).

-- mkt_post.owner_id — denormalized from the parent campaign.
ALTER TABLE "mkt_post" ADD COLUMN "owner_id" UUID;

UPDATE "mkt_post" p
SET "owner_id" = c."owner_id"
FROM "mkt_campaign" c
WHERE p."campaign_id" = c."id" AND p."owner_id" IS NULL;

ALTER TABLE "mkt_post" ALTER COLUMN "owner_id" SET NOT NULL;

CREATE INDEX "ix_post_owner" ON "mkt_post"("owner_id");

ALTER TABLE "mkt_post" ADD CONSTRAINT "mkt_post_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "mkt_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- mkt_lead.owner_id — direct tenant column (leads aren't always campaign-bound).
ALTER TABLE "mkt_lead" ADD COLUMN "owner_id" UUID;

UPDATE "mkt_lead" SET "owner_id" = '00000000-0000-0000-0000-000000000001' WHERE "owner_id" IS NULL;

ALTER TABLE "mkt_lead" ALTER COLUMN "owner_id" SET NOT NULL;

CREATE INDEX "ix_lead_owner" ON "mkt_lead"("owner_id");

ALTER TABLE "mkt_lead" ADD CONSTRAINT "mkt_lead_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "mkt_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- mkt_run_log.owner_id — nullable audit attribution, no FK (system rows have no
-- owner; audit must survive user deletion). Existing rows stay NULL.
ALTER TABLE "mkt_run_log" ADD COLUMN "owner_id" UUID;

CREATE INDEX "ix_mkt_log_owner" ON "mkt_run_log"("owner_id");
