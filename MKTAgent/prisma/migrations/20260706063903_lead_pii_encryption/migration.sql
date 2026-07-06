-- DropIndex
DROP INDEX "ix_lead_email_received";

-- AlterTable
ALTER TABLE "mkt_lead" ADD COLUMN     "email_bidx" TEXT;

-- CreateIndex
CREATE INDEX "ix_lead_email_bidx" ON "mkt_lead"("email_bidx", "received_at");
