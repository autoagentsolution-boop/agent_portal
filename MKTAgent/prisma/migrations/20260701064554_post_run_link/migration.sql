-- AlterTable
ALTER TABLE "mkt_post" ADD COLUMN     "run_id" UUID;

-- CreateIndex
CREATE INDEX "ix_post_run" ON "mkt_post"("run_id");

-- AddForeignKey
ALTER TABLE "mkt_post" ADD CONSTRAINT "mkt_post_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "wf_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
