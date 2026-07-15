-- AlterTable
ALTER TABLE "mkt_lead" ADD COLUMN     "platform" "SocialPlatform",
ADD COLUMN     "platform_handle" TEXT,
ADD COLUMN     "platform_user_id" TEXT,
ALTER COLUMN "email" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "ix_lead_platform_identity" ON "mkt_lead"("owner_id", "platform", "platform_user_id");
