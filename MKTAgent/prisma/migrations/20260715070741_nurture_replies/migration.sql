-- AlterTable
ALTER TABLE "mkt_nurture_thread" ADD COLUMN     "has_unhandled_reply" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_checked_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "mkt_inbound_reply" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "gmail_message_id" TEXT NOT NULL,
    "from_email" TEXT NOT NULL,
    "body_enc" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mkt_inbound_reply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mkt_inbound_reply_gmail_message_id_key" ON "mkt_inbound_reply"("gmail_message_id");

-- CreateIndex
CREATE INDEX "ix_inbound_reply_thread_handled" ON "mkt_inbound_reply"("thread_id", "handled");

-- AddForeignKey
ALTER TABLE "mkt_inbound_reply" ADD CONSTRAINT "mkt_inbound_reply_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "mkt_nurture_thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
