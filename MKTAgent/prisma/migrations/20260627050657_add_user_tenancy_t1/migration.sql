-- T1: multi-tenant foundation. Introduces mkt_user (tenant root) and back-fills
-- existing single-tenant rows onto a deterministic "system/DAIS" owner so live
-- DAIS data is preserved. owner_id is added nullable, back-filled, then locked
-- NOT NULL + FK in the same transaction (Prisma wraps each migration in one).

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('business', 'personal');

-- CreateEnum
CREATE TYPE "ContentLanguage" AS ENUM ('vi', 'en', 'both');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('owner', 'admin');

-- CreateTable
CREATE TABLE "mkt_user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "google_sub" TEXT,
    "password_hash" TEXT,
    "account_type" "AccountType" NOT NULL DEFAULT 'business',
    "default_language" "ContentLanguage" NOT NULL DEFAULT 'both',
    "brand_name" TEXT,
    "brand_voice" TEXT,
    "brand_context" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'owner',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mkt_user_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mkt_user_email_key" ON "mkt_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "mkt_user_google_sub_key" ON "mkt_user"("google_sub");

-- Seed the system/DAIS owner (deterministic id; referenced by T2/T4 back-fills).
-- google_sub stays NULL (not a real Google account); brand fields carry the DAIS
-- business persona so existing copy-gen behaviour is unchanged.
INSERT INTO "mkt_user" ("id", "email", "display_name", "account_type", "default_language", "brand_name", "role", "updated_at")
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'system@dais.local',
    'DAIS (system)',
    'business',
    'both',
    'DAIS',
    'owner',
    CURRENT_TIMESTAMP
);

-- AlterTable: add nullable, back-fill, then enforce.
ALTER TABLE "mkt_campaign" ADD COLUMN "owner_id" UUID;

UPDATE "mkt_campaign" SET "owner_id" = '00000000-0000-0000-0000-000000000001' WHERE "owner_id" IS NULL;

ALTER TABLE "mkt_campaign" ALTER COLUMN "owner_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ix_campaign_owner" ON "mkt_campaign"("owner_id");

-- AddForeignKey
ALTER TABLE "mkt_campaign" ADD CONSTRAINT "mkt_campaign_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "mkt_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
