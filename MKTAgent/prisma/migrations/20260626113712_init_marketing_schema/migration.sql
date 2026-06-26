-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('brief', 'review', 'rework', 'ready', 'posting', 'posted', 'partial', 'error');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('image', 'carousel', 'video');

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('facebook', 'instagram', 'threads', 'linkedin', 'x');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('webhook', 'form', 'calcom');

-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('active', 'needs_attention', 'revoked');

-- CreateTable
CREATE TABLE "mkt_campaign" (
    "id" UUID NOT NULL,
    "product" TEXT NOT NULL,
    "angle" TEXT,
    "brand_context" TEXT,
    "leads_form" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mkt_campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mkt_post" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'brief',
    "asset_type" "AssetType" NOT NULL DEFAULT 'image',
    "copy_vi" TEXT,
    "copy_en" TEXT,
    "copy_threads" TEXT,
    "copy_x" TEXT,
    "length_spec" TEXT,
    "feedback" TEXT,
    "drive_folder_id" TEXT,
    "hero_file" TEXT,
    "platforms" "SocialPlatform"[],
    "scheduled_at" TIMESTAMPTZ(6),
    "post_urls" JSONB,
    "error" TEXT,
    "posted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mkt_post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mkt_lead" (
    "id" UUID NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "message" TEXT,
    "source_product" TEXT,
    "source" "LeadSource" NOT NULL,
    "cal_booking_uid" TEXT,
    "raw_payload" JSONB,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mkt_lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mkt_oauth_token" (
    "platform" "SocialPlatform" NOT NULL,
    "token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "status" "TokenStatus" NOT NULL DEFAULT 'active',
    "last_checked_at" TIMESTAMPTZ(6),
    "meta" JSONB,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mkt_oauth_token_pkey" PRIMARY KEY ("platform")
);

-- CreateTable
CREATE TABLE "mkt_run_log" (
    "id" BIGSERIAL NOT NULL,
    "level" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mkt_run_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_campaign_active" ON "mkt_campaign"("active");

-- CreateIndex
CREATE INDEX "ix_post_status_sched" ON "mkt_post"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "ix_post_campaign" ON "mkt_post"("campaign_id");

-- CreateIndex
CREATE INDEX "ix_lead_email_received" ON "mkt_lead"("email", "received_at");

-- CreateIndex
CREATE INDEX "ix_lead_calcom_uid" ON "mkt_lead"("cal_booking_uid");

-- CreateIndex
CREATE INDEX "ix_mkt_log_created" ON "mkt_run_log"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "mkt_post" ADD CONSTRAINT "mkt_post_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "mkt_campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
