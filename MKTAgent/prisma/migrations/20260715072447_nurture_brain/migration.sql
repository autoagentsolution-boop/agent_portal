-- AlterTable
ALTER TABLE "mkt_nurture_thread" ADD COLUMN     "needs_human" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "mkt_nurture_suppression" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "email_lower" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mkt_nurture_suppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mkt_nurture_suppression_owner_id_email_lower_key" ON "mkt_nurture_suppression"("owner_id", "email_lower");

-- CreateIndex
CREATE INDEX "ix_nurture_thread_unhandled_reply" ON "mkt_nurture_thread"("has_unhandled_reply");

-- AddForeignKey
ALTER TABLE "mkt_nurture_suppression" ADD CONSTRAINT "mkt_nurture_suppression_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "mkt_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
