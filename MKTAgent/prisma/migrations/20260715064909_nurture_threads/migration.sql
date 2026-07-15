-- CreateEnum
CREATE TYPE "NurtureStatus" AS ENUM ('active', 'paused', 'converted', 'opted_out', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "NurtureMode" AS ENUM ('drip', 'conversation');

-- AlterTable
ALTER TABLE "mkt_user" ADD COLUMN     "nurture_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "mkt_nurture_thread" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "sequence_id" TEXT NOT NULL,
    "status" "NurtureStatus" NOT NULL DEFAULT 'active',
    "mode" "NurtureMode" NOT NULL DEFAULT 'drip',
    "touch_number" INTEGER NOT NULL DEFAULT 0,
    "next_plan_at" TIMESTAMPTZ(6),
    "gmail_thread_id" TEXT,
    "last_message_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mkt_nurture_thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mkt_nurture_touch" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "run_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "scheduled_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mkt_nurture_touch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mkt_nurture_thread_lead_id_key" ON "mkt_nurture_thread"("lead_id");

-- CreateIndex
CREATE INDEX "ix_nurture_thread_due" ON "mkt_nurture_thread"("status", "mode", "next_plan_at");

-- CreateIndex
CREATE INDEX "ix_nurture_thread_owner" ON "mkt_nurture_thread"("owner_id");

-- CreateIndex
CREATE INDEX "ix_nurture_touch_thread_index" ON "mkt_nurture_touch"("thread_id", "index");

-- CreateIndex
CREATE INDEX "ix_nurture_touch_status" ON "mkt_nurture_touch"("status");

-- CreateIndex
CREATE INDEX "ix_nurture_touch_run" ON "mkt_nurture_touch"("run_id");

-- AddForeignKey
ALTER TABLE "mkt_nurture_thread" ADD CONSTRAINT "mkt_nurture_thread_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "mkt_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mkt_nurture_thread" ADD CONSTRAINT "mkt_nurture_thread_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "mkt_lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mkt_nurture_touch" ADD CONSTRAINT "mkt_nurture_touch_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "mkt_nurture_thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
