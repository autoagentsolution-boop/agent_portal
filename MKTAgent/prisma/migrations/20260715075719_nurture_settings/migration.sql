-- AlterTable
ALTER TABLE "mkt_user" ADD COLUMN     "nurture_gap_days" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "nurture_max_touches" INTEGER NOT NULL DEFAULT 3;
