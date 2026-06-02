-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Pipeline" AS ENUM ('quiz', 'news_comic', 'life_hacks');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'generating', 'rendering', 'uploading', 'done', 'failed');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('image', 'audio', 'video_clip');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('youtube', 'facebook');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('pending', 'uploaded', 'failed');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('info', 'warn', 'error');

-- CreateEnum
CREATE TYPE "LogStep" AS ENUM ('script', 'image', 'tts', 'render', 'upload');

-- CreateTable
CREATE TABLE "video_job" (
    "id" UUID NOT NULL,
    "pipeline" "Pipeline" NOT NULL,
    "niche" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "script" JSONB,
    "video_path" TEXT,
    "cost_usd" DECIMAL(10,4),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "error" TEXT,

    CONSTRAINT "video_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset" (
    "hash" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "upload_target" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'pending',
    "external_id" TEXT,
    "url" TEXT,
    "uploaded_at" TIMESTAMPTZ(6),
    "error" TEXT,

    CONSTRAINT "upload_target_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_log" (
    "id" BIGSERIAL NOT NULL,
    "job_id" UUID NOT NULL,
    "level" "LogLevel" NOT NULL,
    "step" "LogStep" NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_job_status" ON "video_job"("status");

-- CreateIndex
CREATE INDEX "ix_job_pipeline_created" ON "video_job"("pipeline", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_asset_kind" ON "asset"("kind");

-- CreateIndex
CREATE INDEX "ix_upload_job" ON "upload_target"("job_id");

-- CreateIndex
CREATE INDEX "ix_log_job_created" ON "run_log"("job_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "upload_target" ADD CONSTRAINT "upload_target_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "video_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_log" ADD CONSTRAINT "run_log_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "video_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

