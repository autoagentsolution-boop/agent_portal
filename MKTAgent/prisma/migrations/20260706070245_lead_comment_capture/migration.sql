-- AlterEnum
ALTER TYPE "LeadSource" ADD VALUE 'comment';

-- AlterTable
ALTER TABLE "mkt_post" ADD COLUMN     "comment_source_ids" JSONB,
ADD COLUMN     "lead_capture_keyword" TEXT;
